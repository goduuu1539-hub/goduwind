require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const ASSET_BASE_URL = process.env.ASSET_BASE_URL || `http://localhost:${PORT}`;

const SESSION_ID_REGEX = /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${timestamp}-${randomSuffix}-${safeName}`);
  }
});

const upload = multer({ storage });

const pdfPlaceholderFilename = 'pdf-placeholder.png';
const pdfPlaceholderPath = path.join(uploadsDir, pdfPlaceholderFilename);
const pdfPlaceholderBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
if (!fs.existsSync(pdfPlaceholderPath)) {
  fs.writeFileSync(pdfPlaceholderPath, Buffer.from(pdfPlaceholderBase64, 'base64'));
}
const pdfPlaceholderUrl = `${ASSET_BASE_URL}/uploads/${pdfPlaceholderFilename}`;

const usersByEmail = new Map();
const usersById = new Map();
const sessions = new Map();
const connectionsBySession = new Map();

function generateUUID() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function createId(prefix) {
  return prefix ? `${prefix}_${generateUUID()}` : generateUUID();
}

function createSessionId() {
  const randomSegment = () => {
    let segment = '';
    for (let i = 0; i < 3; i += 1) {
      segment += String.fromCharCode(97 + Math.floor(Math.random() * 26));
    }
    return segment;
  };

  let id = `${randomSegment()}-${randomSegment()}-${randomSegment()}`;
  while (sessions.has(id)) {
    id = `${randomSegment()}-${randomSegment()}-${randomSegment()}`;
  }
  return id;
}

function cloneSlides(slides) {
  return slides.map((slide) => ({ ...slide }));
}

function cloneStrokes(strokes) {
  const result = {};
  Object.entries(strokes).forEach(([slideId, strokeList]) => {
    result[slideId] = strokeList.map((stroke) => ({ ...stroke }));
  });
  return result;
}

function cloneChatHistory(history) {
  return history.map((entry) => ({ ...entry }));
}

function serializeSession(session, options = {}) {
  const { includeStrokes = false, includeChatHistory = false } = options;
  const serialized = {
    id: session.id,
    title: session.title,
    description: session.description,
    ownerId: session.ownerId,
    status: session.status,
    createdAt: session.createdAt,
    startedAt: session.startedAt || null,
    endedAt: session.endedAt || null,
    slides: cloneSlides(session.slides),
    currentSlideId: session.currentSlideId,
    chatEnabled: session.chatEnabled
  };

  if (includeStrokes) {
    serialized.strokes = cloneStrokes(session.strokes);
  }

  if (includeChatHistory) {
    serialized.chatHistory = cloneChatHistory(session.chatHistory);
  }

  return serialized;
}

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') {
    return null;
  }
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }
  return token;
}

function authenticateHttp(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = usersById.get(payload.userId);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

function getSessionOrRespond(sessionId, res) {
  if (!SESSION_ID_REGEX.test(sessionId)) {
    res.status(400).json({ message: 'Invalid session id format' });
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ message: 'Session not found' });
    return null;
  }

  return session;
}

function requireSessionOwner(session, user, res, options = {}) {
  const { statusCode = 403, message = 'Forbidden' } = options;
  if (session.ownerId !== user.id) {
    res.status(statusCode).json({ message });
    return false;
  }
  return true;
}

function ensureSlide(session, slideId) {
  return session.slides.find((slide) => slide.id === slideId) || null;
}

function notifySlideChange(session) {
  broadcast(session.id, 'SLIDE_CHANGED', {
    sessionId: session.id,
    slideId: session.currentSlideId,
    slides: cloneSlides(session.slides)
  });
}

function broadcast(sessionId, type, payload, options = {}) {
  const { exclude } = options;
  const listeners = connectionsBySession.get(sessionId);
  if (!listeners) {
    return;
  }

  listeners.forEach((client) => {
    if (exclude && client === exclude) {
      return;
    }
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, payload }));
    }
  });
}

function sendMessage(ws, type, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

app.post('/api/v1/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = email.toLowerCase();
    if (usersByEmail.has(normalizedEmail)) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: createId('user'),
      email: normalizedEmail,
      name: name || normalizedEmail,
      passwordHash,
      createdAt: new Date().toISOString()
    };

    usersByEmail.set(normalizedEmail, user);
    usersById.set(user.id, user);

    return res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt
    });
  } catch (error) {
    return res.status(400).json({ message: 'Invalid request' });
  }
});

app.post('/api/v1/signin', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase();
    const user = usersByEmail.get(normalizedEmail);
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '12h' });

    return res.status(200).json({ token });
  } catch (error) {
    return res.status(400).json({ message: 'Bad request' });
  }
});

app.post('/api/v1/session', authenticateHttp, (req, res) => {
  try {
    const { title, description } = req.body || {};
    const sessionId = createSessionId();

    const session = {
      id: sessionId,
      title: title && typeof title === 'string' ? title : 'Untitled Session',
      description: description && typeof description === 'string' ? description : '',
      ownerId: req.user.id,
      createdAt: new Date().toISOString(),
      status: 'idle',
      slides: [],
      strokes: {},
      currentSlideId: null,
      chatEnabled: true,
      chatHistory: []
    };

    sessions.set(sessionId, session);

    return res.status(201).json(serializeSession(session, { includeStrokes: true, includeChatHistory: true }));
  } catch (error) {
    return res.status(400).json({ message: 'Invalid request' });
  }
});

app.get('/api/v1/sessions', authenticateHttp, (_req, res) => {
  try {
    const list = Array.from(sessions.values()).map((session) => serializeSession(session));
    return res.status(200).json({ sessions: list });
  } catch (error) {
    return res.status(400).json({ message: 'Invalid request' });
  }
});

app.post('/api/v1/session/:sessionId/start', authenticateHttp, (req, res) => {
  const { sessionId } = req.params;
  const session = getSessionOrRespond(sessionId, res);
  if (!session) {
    return;
  }

  if (!requireSessionOwner(session, req.user, res, { statusCode: 400, message: 'Unauthorized' })) {
    return;
  }

  if (session.status === 'live') {
    return res.status(200).json({ message: 'Session already live', session: serializeSession(session) });
  }

  session.status = 'live';
  session.startedAt = new Date().toISOString();

  broadcast(session.id, 'SESSION_STARTED', { sessionId: session.id });

  return res.status(200).json({ message: 'Session started', session: serializeSession(session) });
});

app.post('/api/v1/session/:sessionId/end', authenticateHttp, (req, res) => {
  const { sessionId } = req.params;
  const session = getSessionOrRespond(sessionId, res);
  if (!session) {
    return;
  }

  if (!requireSessionOwner(session, req.user, res, { statusCode: 400, message: 'Unauthorized' })) {
    return;
  }

  if (session.status === 'ended') {
    return res.status(200).json({ message: 'Session already ended', session: serializeSession(session) });
  }

  session.status = 'ended';
  session.endedAt = new Date().toISOString();

  broadcast(session.id, 'SESSION_ENDED', { sessionId: session.id });

  return res.status(200).json({ message: 'Session ended', session: serializeSession(session) });
});

app.post('/api/v1/session/:sessionId/slides/pdf', authenticateHttp, upload.single('file'), (req, res) => {
  const { sessionId } = req.params;
  const session = getSessionOrRespond(sessionId, res);
  if (!session) {
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    return;
  }

  if (!requireSessionOwner(session, req.user, res)) {
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    return;
  }

  if (!req.file) {
    return res.status(400).json({ message: 'File is required' });
  }

  if (req.file.mimetype !== 'application/pdf') {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ message: 'Only PDF files are allowed' });
  }

  const slide = {
    id: createId('slide'),
    type: 'pdf',
    name: req.file.originalname,
    sourceUrl: `${ASSET_BASE_URL}/uploads/${req.file.filename}`,
    previewImageUrl: pdfPlaceholderUrl,
    createdAt: new Date().toISOString()
  };

  session.slides.push(slide);
  session.strokes[slide.id] = [];
  session.currentSlideId = slide.id;

  notifySlideChange(session);

  return res.status(200).json({ slides: cloneSlides(session.slides) });
});

app.post('/api/v1/session/:sessionId/slides/image', authenticateHttp, upload.single('file'), (req, res) => {
  const { sessionId } = req.params;
  const session = getSessionOrRespond(sessionId, res);
  if (!session) {
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    return;
  }

  if (!requireSessionOwner(session, req.user, res)) {
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    return;
  }

  if (!req.file) {
    return res.status(400).json({ message: 'File is required' });
  }

  if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ message: 'Only image files are allowed' });
  }

  const slide = {
    id: createId('slide'),
    type: 'image',
    name: req.file.originalname,
    sourceUrl: `${ASSET_BASE_URL}/uploads/${req.file.filename}`,
    previewImageUrl: `${ASSET_BASE_URL}/uploads/${req.file.filename}`,
    createdAt: new Date().toISOString()
  };

  session.slides.push(slide);
  session.strokes[slide.id] = [];
  session.currentSlideId = slide.id;

  notifySlideChange(session);

  return res.status(200).json({ slides: cloneSlides(session.slides) });
});

app.post('/api/v1/session/:sessionId/slides', authenticateHttp, (req, res) => {
  const { sessionId } = req.params;
  const session = getSessionOrRespond(sessionId, res);
  if (!session) {
    return;
  }

  if (!requireSessionOwner(session, req.user, res)) {
    return;
  }

  const slide = {
    id: createId('slide'),
    type: 'empty',
    name: 'Empty Slide',
    sourceUrl: null,
    previewImageUrl: null,
    createdAt: new Date().toISOString()
  };

  session.slides.push(slide);
  session.strokes[slide.id] = [];
  session.currentSlideId = slide.id;

  notifySlideChange(session);

  return res.status(200).json({ slides: cloneSlides(session.slides) });
});

app.delete('/api/v1/session/:sessionId/slide/:slideId', authenticateHttp, (req, res) => {
  const { sessionId, slideId } = req.params;
  const session = getSessionOrRespond(sessionId, res);
  if (!session) {
    return;
  }

  if (!requireSessionOwner(session, req.user, res)) {
    return;
  }

  const slideIndex = session.slides.findIndex((slide) => slide.id === slideId);
  if (slideIndex === -1) {
    return res.status(404).json({ message: 'Slide not found' });
  }

  session.slides.splice(slideIndex, 1);
  delete session.strokes[slideId];

  if (session.currentSlideId === slideId) {
    const nextSlide = session.slides[slideIndex] || session.slides[slideIndex - 1] || session.slides[0] || null;
    session.currentSlideId = nextSlide ? nextSlide.id : null;
    notifySlideChange(session);
  } else {
    notifySlideChange(session);
  }

  return res.status(200).json({ slides: cloneSlides(session.slides) });
});

app.get('/api/v1/session/:sessionId/state', authenticateHttp, (req, res) => {
  const { sessionId } = req.params;
  const session = getSessionOrRespond(sessionId, res);
  if (!session) {
    return;
  }

  return res.status(200).json(serializeSession(session, { includeStrokes: true, includeChatHistory: true }));
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

function detachFromCurrentSession(ws) {
  if (!ws.sessionId) {
    return;
  }
  const listeners = connectionsBySession.get(ws.sessionId);
  if (listeners) {
    listeners.delete(ws);
    if (listeners.size === 0) {
      connectionsBySession.delete(ws.sessionId);
    }
  }
  ws.sessionId = null;
  ws.isAdmin = false;
}

function registerConnection(ws, sessionId, isAdmin) {
  detachFromCurrentSession(ws);
  ws.sessionId = sessionId;
  ws.isAdmin = isAdmin;

  if (!connectionsBySession.has(sessionId)) {
    connectionsBySession.set(sessionId, new Set());
  }
  connectionsBySession.get(sessionId).add(ws);
}

function resolveUserFromToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = usersById.get(payload.userId);
    if (!user) {
      return null;
    }
    return user;
  } catch (error) {
    return null;
  }
}

function handleSubscribe(ws, payload, isAdmin) {
  if (!payload || typeof payload.roomId !== 'string') {
    sendMessage(ws, 'ERROR', { message: 'roomId is required' });
    return;
  }

  const roomId = payload.roomId;
  if (!SESSION_ID_REGEX.test(roomId)) {
    sendMessage(ws, 'ERROR', { message: 'Invalid session id format' });
    return;
  }

  const session = sessions.get(roomId);
  if (!session) {
    sendMessage(ws, 'ERROR', { message: 'Session not found' });
    return;
  }

  if (isAdmin && session.ownerId !== ws.user.id) {
    sendMessage(ws, 'ERROR', { message: 'Forbidden' });
    return;
  }

  registerConnection(ws, session.id, isAdmin);

  sendMessage(ws, 'SUBSCRIBED', {
    role: isAdmin ? 'admin' : 'participant',
    session: serializeSession(session, { includeStrokes: true, includeChatHistory: true })
  });
}

function handleStroke(ws, payload) {
  if (!ws.sessionId) {
    sendMessage(ws, 'ERROR', { message: 'Not subscribed to session' });
    return;
  }

  if (!payload || typeof payload.slideId !== 'string' || typeof payload.stroke !== 'object') {
    sendMessage(ws, 'ERROR', { message: 'Invalid stroke payload' });
    return;
  }

  const session = sessions.get(ws.sessionId);
  if (!session) {
    sendMessage(ws, 'ERROR', { message: 'Session not found' });
    return;
  }

  const slide = ensureSlide(session, payload.slideId);
  if (!slide) {
    sendMessage(ws, 'ERROR', { message: 'Slide not found' });
    return;
  }

  if (!session.strokes[slide.id]) {
    session.strokes[slide.id] = [];
  }

  const strokeRecord = {
    id: createId('stroke'),
    ...payload.stroke,
    userId: ws.user.id,
    createdAt: new Date().toISOString()
  };

  session.strokes[slide.id].push(strokeRecord);

  if (session.currentSlideId !== slide.id) {
    session.currentSlideId = slide.id;
    notifySlideChange(session);
  }

  broadcast(session.id, 'STROKE', { slideId: slide.id, stroke: strokeRecord });
}

function handleClearSlide(ws, payload) {
  if (!ws.sessionId) {
    sendMessage(ws, 'ERROR', { message: 'Not subscribed to session' });
    return;
  }

  if (!payload || typeof payload.slideId !== 'string') {
    sendMessage(ws, 'ERROR', { message: 'slideId is required' });
    return;
  }

  const session = sessions.get(ws.sessionId);
  if (!session) {
    sendMessage(ws, 'ERROR', { message: 'Session not found' });
    return;
  }

  if (!session.strokes[payload.slideId]) {
    session.strokes[payload.slideId] = [];
  }

  session.strokes[payload.slideId] = [];

  broadcast(session.id, 'CLEAR_SLIDE', { slideId: payload.slideId });
}

function handleChatMessage(ws, payload) {
  if (!ws.sessionId) {
    sendMessage(ws, 'ERROR', { message: 'Not subscribed to session' });
    return;
  }

  if (!payload || typeof payload.message !== 'string' || !payload.message.trim()) {
    sendMessage(ws, 'ERROR', { message: 'Message is required' });
    return;
  }

  const session = sessions.get(ws.sessionId);
  if (!session) {
    sendMessage(ws, 'ERROR', { message: 'Session not found' });
    return;
  }

  if (!session.chatEnabled && !ws.isAdmin) {
    sendMessage(ws, 'ERROR', { message: 'Chat is disabled' });
    return;
  }

  const chatMessage = {
    id: createId('chat'),
    userId: ws.user.id,
    userName: ws.user.name,
    message: payload.message.trim(),
    timestamp: new Date().toISOString()
  };

  session.chatHistory.push(chatMessage);
  broadcast(session.id, 'CHAT_MESSAGE', chatMessage);
}

function handleChatEnable(ws, payload) {
  if (!ws.sessionId) {
    sendMessage(ws, 'ERROR', { message: 'Not subscribed to session' });
    return;
  }

  if (!payload || typeof payload.enabled !== 'boolean') {
    sendMessage(ws, 'ERROR', { message: 'enabled flag is required' });
    return;
  }

  const session = sessions.get(ws.sessionId);
  if (!session) {
    sendMessage(ws, 'ERROR', { message: 'Session not found' });
    return;
  }

  session.chatEnabled = payload.enabled;
  broadcast(session.id, 'CHAT_ENABLE', { enabled: session.chatEnabled });
}

wss.on('connection', (ws, req) => {
  try {
    const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
    const token = requestUrl.searchParams.get('token');

    if (!token) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    const user = resolveUserFromToken(token);
    if (!user) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    ws.user = user;
    ws.sessionId = null;
    ws.isAdmin = false;

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        sendMessage(ws, 'ERROR', { message: 'Invalid JSON payload' });
        return;
      }

      if (!message || typeof message.type !== 'string') {
        sendMessage(ws, 'ERROR', { message: 'Invalid message format' });
        return;
      }

      switch (message.type) {
        case 'SUBSCRIBE':
          handleSubscribe(ws, message.payload, false);
          break;
        case 'SUBSCRIBE_ADMIN':
          handleSubscribe(ws, message.payload, true);
          break;
        case 'STROKE':
          if (ws.isAdmin) {
            handleStroke(ws, message.payload);
          } else {
            sendMessage(ws, 'ERROR', { message: 'Admin privileges required' });
          }
          break;
        case 'CLEAR_SLIDE':
          if (ws.isAdmin) {
            handleClearSlide(ws, message.payload);
          } else {
            sendMessage(ws, 'ERROR', { message: 'Admin privileges required' });
          }
          break;
        case 'CHAT_MESSAGE':
          handleChatMessage(ws, message.payload);
          break;
        case 'CHAT_ENABLE':
          if (ws.isAdmin) {
            handleChatEnable(ws, message.payload);
          } else {
            sendMessage(ws, 'ERROR', { message: 'Admin privileges required' });
          }
          break;
        default:
          sendMessage(ws, 'ERROR', { message: 'Unsupported message type' });
          break;
      }
    });

    ws.on('close', () => {
      detachFromCurrentSession(ws);
    });

    ws.on('error', () => {
      detachFromCurrentSession(ws);
    });
  } catch (error) {
    ws.close(1008, 'Unauthorized');
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${PORT}`);
});
