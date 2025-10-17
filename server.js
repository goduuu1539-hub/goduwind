require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID, randomBytes, createHash } = require('crypto');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${generateId()}${path.extname(file.originalname)}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// In-memory stores
const usersByEmail = new Map();
const usersById = new Map();
const tokens = new Map();
const sessions = new Map();
const sessionSubscribers = new Map();
const socketMetadata = new Map(); // ws -> { sessionId, isAdmin }

// Helpers
function generateId() {
  return typeof randomUUID === 'function' ? randomUUID() : randomBytes(16).toString('hex');
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

function now() {
  return new Date().toISOString();
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role
  };
}

function serializeSlide(slide) {
  return {
    id: slide.id,
    type: slide.type,
    title: slide.title,
    url: slide.asset ? slide.asset.url : null,
    mimetype: slide.asset ? slide.asset.mimetype : null,
    size: slide.asset ? slide.asset.size : null,
    createdAt: slide.createdAt
  };
}

function serializeSession(session) {
  return {
    id: session.id,
    title: session.title,
    description: session.description,
    createdBy: session.createdBy,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
    chatEnabled: session.chatEnabled,
    currentSlideId: session.currentSlideId,
    slides: session.slides.map(serializeSlide)
  };
}

function buildSessionState(session) {
  return {
    ...serializeSession(session),
    strokes: session.strokes,
    chatMessages: session.chatMessages
  };
}

function broadcastToSession(sessionId, payload, options = {}) {
  const subscribers = sessionSubscribers.get(sessionId);
  if (!subscribers) return;

  const message = JSON.stringify(payload);
  subscribers.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (options.exclude && client === options.exclude) return;
    client.send(message);
  });
}

function broadcastSessionState(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  broadcastToSession(sessionId, {
    type: 'session_state',
    sessionId,
    state: buildSessionState(session)
  });
}

function requireSessionOwner(session, userId) {
  return session.createdBy === userId;
}

function createSlide({ type, file, title }) {
  return {
    id: generateId(),
    type,
    title: title || (file ? file.originalname : 'Untitled Slide'),
    createdAt: now(),
    asset: file
      ? {
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          url: `/uploads/${file.filename}`,
          storagePath: file.path
        }
      : null
  };
}

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.warn(`Failed to remove file ${filePath}: ${error.message}`);
    }
  }
}

function authenticate(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  const [scheme, token] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Invalid authorization format' });
  }

  const userId = tokens.get(token);
  if (!userId) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = usersById.get(userId);
  if (!user) {
    tokens.delete(token);
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.user = user;
  req.token = token;
  next();
}

// Routes
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/signup', (req, res) => {
  const { email, password, role } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (usersByEmail.has(normalizedEmail)) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const user = {
    id: generateId(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    role: role || 'user'
  };

  usersByEmail.set(normalizedEmail, user);
  usersById.set(user.id, user);

  const token = generateToken();
  tokens.set(token, user.id);

  res.status(201).json({
    token,
    user: sanitizeUser(user)
  });
});

app.post('/signin', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = usersByEmail.get(normalizedEmail);

  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken();
  tokens.set(token, user.id);

  res.json({
    token,
    user: sanitizeUser(user)
  });
});

app.use(authenticate);

app.get('/sessions', (_req, res) => {
  const data = Array.from(sessions.values()).map(serializeSession);
  res.json(data);
});

app.post('/sessions', (req, res) => {
  const { title, description } = req.body || {};

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const session = {
    id: generateId(),
    title,
    description: description || '',
    createdBy: req.user.id,
    createdAt: now(),
    startedAt: null,
    endedAt: null,
    status: 'draft',
    chatEnabled: false,
    currentSlideId: null,
    slides: [],
    strokes: [],
    chatMessages: []
  };

  sessions.set(session.id, session);
  res.status(201).json(serializeSession(session));
});

app.get('/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json(serializeSession(session));
});

app.put('/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!requireSessionOwner(session, req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { title, description, chatEnabled } = req.body || {};

  if (title !== undefined) {
    session.title = title;
  }

  if (description !== undefined) {
    session.description = description;
  }

  if (typeof chatEnabled === 'boolean' && session.chatEnabled !== chatEnabled) {
    session.chatEnabled = chatEnabled;
    broadcastToSession(session.id, {
      type: 'chat_enable',
      sessionId: session.id,
      enabled: session.chatEnabled
    });
  }

  broadcastSessionState(session.id);
  res.json(serializeSession(session));
});

app.delete('/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!requireSessionOwner(session, req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  session.slides.forEach((slide) => {
    const storagePath = slide.asset && slide.asset.storagePath;
    if (storagePath) {
      safeUnlink(storagePath);
    }
  });

  sessions.delete(session.id);

  const subscribers = sessionSubscribers.get(session.id);
  if (subscribers) {
    const message = JSON.stringify({ type: 'session_closed', sessionId: session.id });
    subscribers.forEach((ws) => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
          ws.close(1000, 'Session deleted');
        }
      } catch (_err) {
        // ignore
      }
      socketMetadata.delete(ws);
    });
    sessionSubscribers.delete(session.id);
  }

  res.status(204).send();
});

app.post('/sessions/:sessionId/start', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!requireSessionOwner(session, req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  session.status = 'live';
  session.startedAt = now();
  session.endedAt = null;

  broadcastSessionState(session.id);
  res.json(serializeSession(session));
});

app.post('/sessions/:sessionId/end', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!requireSessionOwner(session, req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  session.status = 'ended';
  session.endedAt = now();

  broadcastSessionState(session.id);
  res.json(serializeSession(session));
});

app.post('/sessions/:sessionId/slides/pdf', upload.single('file'), (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    if (req.file) safeUnlink(req.file.path);
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!requireSessionOwner(session, req.user.id)) {
    if (req.file) safeUnlink(req.file.path);
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'PDF file is required' });
  }

  if (req.file.mimetype !== 'application/pdf') {
    safeUnlink(req.file.path);
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }

  const slide = createSlide({ type: 'pdf', file: req.file });
  session.slides.push(slide);
  if (!session.currentSlideId) {
    session.currentSlideId = slide.id;
  }

  broadcastSessionState(session.id);
  res.status(201).json(serializeSlide(slide));
});

app.post('/sessions/:sessionId/slides/image', upload.single('file'), (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    if (req.file) safeUnlink(req.file.path);
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!requireSessionOwner(session, req.user.id)) {
    if (req.file) safeUnlink(req.file.path);
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required' });
  }

  if (!req.file.mimetype.startsWith('image/')) {
    safeUnlink(req.file.path);
    return res.status(400).json({ error: 'Only image files are allowed' });
  }

  const slide = createSlide({ type: 'image', file: req.file });
  session.slides.push(slide);
  if (!session.currentSlideId) {
    session.currentSlideId = slide.id;
  }

  broadcastSessionState(session.id);
  res.status(201).json(serializeSlide(slide));
});

app.post('/sessions/:sessionId/slides/empty', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!requireSessionOwner(session, req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const slide = createSlide({ type: 'empty', title: req.body?.title || 'Empty Slide' });
  session.slides.push(slide);
  if (!session.currentSlideId) {
    session.currentSlideId = slide.id;
  }

  broadcastSessionState(session.id);
  res.status(201).json(serializeSlide(slide));
});

app.delete('/sessions/:sessionId/slides/:slideId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!requireSessionOwner(session, req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const index = session.slides.findIndex((slide) => slide.id === req.params.slideId);
  if (index === -1) {
    return res.status(404).json({ error: 'Slide not found' });
  }

  const [removed] = session.slides.splice(index, 1);
  const storagePath = removed.asset && removed.asset.storagePath;
  if (storagePath) {
    safeUnlink(storagePath);
  }

  if (session.currentSlideId === removed.id) {
    session.currentSlideId = session.slides.length ? session.slides[0].id : null;
  }

  broadcastSessionState(session.id);
  res.status(204).send();
});

app.get('/sessions/:sessionId/state', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    sessionId: session.id,
    state: buildSessionState(session)
  });
});

// WebSocket handlers
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch (_err) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
    }

    const { type } = payload;
    switch (type) {
      case 'subscribe':
        return handleSubscribe(ws, payload);
      case 'admin_subscribe':
        return handleAdminSubscribe(ws, payload);
      case 'stroke':
        return handleStroke(ws, payload);
      case 'clear':
        return handleClear(ws);
      case 'chat_message':
        return handleChatMessage(ws, payload);
      case 'chat_enable':
        return handleChatEnable(ws, payload);
      default:
        return ws.send(JSON.stringify({ type: 'error', message: 'Unknown event type' }));
    }
  });

  ws.on('close', () => {
    const meta = socketMetadata.get(ws);
    if (!meta) return;

    const { sessionId } = meta;
    if (sessionId && sessionSubscribers.has(sessionId)) {
      sessionSubscribers.get(sessionId).delete(ws);
      if (sessionSubscribers.get(sessionId).size === 0) {
        sessionSubscribers.delete(sessionId);
      }
    }

    socketMetadata.delete(ws);
  });
});

function handleSubscribe(ws, payload) {
  const { sessionId } = payload;
  if (!sessionId) {
    return ws.send(JSON.stringify({ type: 'error', message: 'sessionId is required' }));
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
  }

  registerSubscription(ws, sessionId, false);

  ws.send(JSON.stringify({ type: 'subscribed', sessionId, isAdmin: false }));
  ws.send(JSON.stringify({ type: 'session_state', sessionId, state: buildSessionState(session) }));
}

function handleAdminSubscribe(ws, payload) {
  const { sessionId, token } = payload;
  if (!sessionId || !token) {
    return ws.send(JSON.stringify({ type: 'error', message: 'sessionId and token are required' }));
  }

  const userId = tokens.get(token);
  if (!userId) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
  }

  if (session.createdBy !== userId) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Not authorized for admin access' }));
  }

  registerSubscription(ws, sessionId, true);

  ws.send(JSON.stringify({ type: 'subscribed', sessionId, isAdmin: true }));
  ws.send(JSON.stringify({ type: 'session_state', sessionId, state: buildSessionState(session) }));
}

function handleStroke(ws, payload) {
  const meta = socketMetadata.get(ws);
  if (!meta) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Subscribe to a session first' }));
  }

  const session = sessions.get(meta.sessionId);
  if (!session) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
  }

  const stroke = payload.stroke;
  if (!stroke || typeof stroke !== 'object') {
    return ws.send(JSON.stringify({ type: 'error', message: 'stroke payload is required' }));
  }

  const strokeEntry = {
    id: generateId(),
    ...stroke,
    timestamp: now()
  };

  session.strokes.push(strokeEntry);
  if (session.strokes.length > 5000) {
    session.strokes.shift();
  }

  broadcastToSession(session.id, {
    type: 'stroke',
    sessionId: session.id,
    stroke: strokeEntry
  });
}

function handleClear(ws) {
  const meta = socketMetadata.get(ws);
  if (!meta) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Subscribe to a session first' }));
  }

  if (!meta.isAdmin) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Admin privileges required' }));
  }

  const session = sessions.get(meta.sessionId);
  if (!session) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
  }

  session.strokes = [];

  broadcastToSession(session.id, { type: 'clear', sessionId: session.id });
  broadcastSessionState(session.id);
}

function handleChatMessage(ws, payload) {
  const meta = socketMetadata.get(ws);
  if (!meta) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Subscribe to a session first' }));
  }

  const session = sessions.get(meta.sessionId);
  if (!session) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
  }

  if (!session.chatEnabled) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Chat is disabled' }));
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    return ws.send(JSON.stringify({ type: 'error', message: 'text is required' }));
  }

  const chatMessage = {
    id: generateId(),
    username: payload.username || 'Anonymous',
    text,
    timestamp: now()
  };

  session.chatMessages.push(chatMessage);
  if (session.chatMessages.length > 500) {
    session.chatMessages.shift();
  }

  broadcastToSession(session.id, {
    type: 'chat_message',
    sessionId: session.id,
    message: chatMessage
  });
}

function handleChatEnable(ws, payload) {
  const meta = socketMetadata.get(ws);
  if (!meta) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Subscribe to a session first' }));
  }

  if (!meta.isAdmin) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Admin privileges required' }));
  }

  const session = sessions.get(meta.sessionId);
  if (!session) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
  }

  if (typeof payload.enabled !== 'boolean') {
    return ws.send(JSON.stringify({ type: 'error', message: 'enabled flag is required' }));
  }

  session.chatEnabled = payload.enabled;

  broadcastToSession(session.id, {
    type: 'chat_enable',
    sessionId: session.id,
    enabled: session.chatEnabled
  });
  broadcastSessionState(session.id);
}

function registerSubscription(ws, sessionId, isAdmin) {
  const existingMeta = socketMetadata.get(ws);
  if (existingMeta && existingMeta.sessionId && sessionSubscribers.has(existingMeta.sessionId)) {
    sessionSubscribers.get(existingMeta.sessionId).delete(ws);
  }

  if (!sessionSubscribers.has(sessionId)) {
    sessionSubscribers.set(sessionId, new Set());
  }

  sessionSubscribers.get(sessionId).add(ws);
  socketMetadata.set(ws, { sessionId, isAdmin });
}

// Error handling middleware
// Multer errors and general errors
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }

  if (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }

  return res.status(500).json({ error: 'Unknown error' });
});

server.listen(PORT, () => {
  console.log(`HTTP server listening on http://localhost:${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}`);
});
