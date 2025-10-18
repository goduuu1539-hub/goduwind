import { Server as HttpServer, IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { URL } from 'url';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Prisma, SessionStatus } from '@prisma/client';
import { prisma } from '../server/lib/prisma';
import { serializeSlide, serializeStroke } from '../server/utils/serializers';
import { env } from '../server/config/env';

type TokenPayload = {
  sub?: string;
  userId?: string;
};

type ClientMeta = {
  userId: string;
  email: string;
  isAdmin: boolean;
  sessionId?: string;
};

type OutgoingMessage = {
  type: string;
  payload?: unknown;
};

type ChatMessage = {
  id: string;
  sessionId: string;
  userId: string;
  email: string;
  message: string;
  timestamp: string;
};

const subscribeSchema = z.object({
  roomId: z.string().min(1)
});

const strokeSchema = z.object({
  sessionId: z.string().min(1),
  slideId: z.string().min(1),
  stroke: z.unknown()
});

const clearSlideSchema = z.object({
  sessionId: z.string().min(1),
  slideId: z.string().min(1)
});

const chatMessageSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().trim().min(1).max(1000)
});

const chatToggleSchema = z.object({
  sessionId: z.string().min(1),
  enabled: z.boolean()
});

class WebSocketManager {
  private readonly wss: WebSocketServer;

  private readonly clients = new WeakMap<WebSocket, ClientMeta>();

  private readonly rooms = new Map<string, Set<WebSocket>>();

  private readonly chatMessages = new Map<string, ChatMessage[]>();

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server });
    this.wss.on('connection', (socket, request) => {
      this.handleConnection(socket, request).catch((error) => {
        console.error('WebSocket connection error:', error);
        socket.close(1011, 'Internal server error');
      });
    });
  }

  public broadcast(sessionId: string, message: OutgoingMessage, options?: { exclude?: WebSocket }) {
    const room = this.rooms.get(sessionId);
    if (!room || room.size === 0) {
      return;
    }

    const serialized = JSON.stringify(message);
    for (const client of room) {
      if (options?.exclude && client === options.exclude) {
        continue;
      }

      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  private async handleConnection(socket: WebSocket, request: IncomingMessage) {
    const meta = await this.authenticate(socket, request);
    if (!meta) {
      return;
    }

    this.clients.set(socket, meta);

    socket.on('message', (data) => {
      this.handleMessage(socket, data).catch((error) => {
        console.error('WebSocket message error:', error);
        this.send(socket, {
          type: 'ERROR',
          payload: { message: 'Internal server error' }
        });
      });
    });

    socket.on('close', () => {
      this.leaveRoom(socket);
      this.clients.delete(socket);
    });

    socket.on('error', (error) => {
      console.error('WebSocket client error:', error);
    });
  }

  private async authenticate(socket: WebSocket, request: IncomingMessage): Promise<ClientMeta | null> {
    try {
      const url = new URL(request.url ?? '/', `http://localhost:${env.PORT}`);
      const token = url.searchParams.get('token');
      if (!token) {
        socket.close(4401, 'Missing token');
        return null;
      }

      const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
      const userId = payload.sub ?? payload.userId;
      if (!userId) {
        socket.close(4401, 'Invalid token');
        return null;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        socket.close(4401, 'Invalid token');
        return null;
      }

      return {
        userId: user.id,
        email: user.email,
        isAdmin: false
      };
    } catch (error) {
      console.error('WebSocket authentication failed:', error);
      socket.close(4401, 'Authentication failed');
      return null;
    }
  }

  private async handleMessage(socket: WebSocket, data: RawData) {
    const client = this.clients.get(socket);
    if (!client) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Unauthorized' } });
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(data.toString());
    } catch (_error) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Invalid message format' } });
      return;
    }

    const typeValue = typeof parsed.type === 'string' ? parsed.type.toUpperCase() : null;
    if (!typeValue) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Message type is required' } });
      return;
    }

    switch (typeValue) {
      case 'SUBSCRIBE': {
        const { roomId } = subscribeSchema.parse(parsed.payload ?? {});
        await this.subscribe(socket, client, roomId, false);
        break;
      }
      case 'SUBSCRIBE_ADMIN': {
        const { roomId } = subscribeSchema.parse(parsed.payload ?? {});
        await this.subscribe(socket, client, roomId, true);
        break;
      }
      case 'STROKE': {
        const payload = strokeSchema.parse(parsed.payload ?? {});
        await this.handleStroke(socket, client, payload.sessionId, payload.slideId, payload.stroke);
        break;
      }
      case 'CLEAR_SLIDE': {
        const payload = clearSlideSchema.parse(parsed.payload ?? {});
        await this.handleClearSlide(socket, client, payload.sessionId, payload.slideId);
        break;
      }
      case 'CHAT_MESSAGE': {
        const payload = chatMessageSchema.parse(parsed.payload ?? {});
        await this.handleChatMessage(socket, client, payload.sessionId, payload.message);
        break;
      }
      case 'CHAT_ENABLE': {
        const payload = chatToggleSchema.parse(parsed.payload ?? {});
        await this.handleChatToggle(socket, client, payload.sessionId, payload.enabled);
        break;
      }
      default:
        this.send(socket, { type: 'ERROR', payload: { message: `Unsupported message type: ${typeValue}` } });
    }
  }

  private async subscribe(socket: WebSocket, client: ClientMeta, sessionId: string, asAdmin: boolean) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { slides: { orderBy: { order: 'asc' } } }
    });

    if (!session) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Session not found' } });
      return;
    }

    if (asAdmin && session.ownerId !== client.userId) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Admin access denied' } });
      return;
    }

    this.leaveRoom(socket);

    client.sessionId = sessionId;
    client.isAdmin = asAdmin;

    const room = this.rooms.get(sessionId) ?? new Set<WebSocket>();
    room.add(socket);
    this.rooms.set(sessionId, room);

    const strokes = session.currentSlideId
      ? await prisma.stroke.findMany({
          where: { sessionId: session.id, slideId: session.currentSlideId },
          orderBy: { createdAt: 'asc' }
        })
      : [];

    const chatMessages = this.chatMessages.get(sessionId) ?? [];

    this.send(socket, {
      type: 'SUBSCRIBED',
      payload: {
        isAdmin: client.isAdmin,
        session: {
          sessionId: session.id,
          status: session.status,
          chatEnabled: session.chatEnabled,
          currentSlideId: session.currentSlideId,
          slides: session.slides.map(serializeSlide)
        },
        strokes: strokes.map(serializeStroke),
        chatMessages
      }
    });

    if (session.status === SessionStatus.LIVE) {
      this.send(socket, {
        type: 'SESSION_STARTED',
        payload: {
          sessionId: session.id,
          startedAt: session.startedAt?.toISOString() ?? null
        }
      });
    }

    if (session.status === SessionStatus.ENDED) {
      this.send(socket, {
        type: 'SESSION_ENDED',
        payload: {
          sessionId: session.id,
          endedAt: session.endedAt?.toISOString() ?? null
        }
      });
    }
  }

  private async handleStroke(socket: WebSocket, client: ClientMeta, sessionId: string, slideId: string, stroke: unknown) {
    if (!client.isAdmin) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Admin privileges required' } });
      return;
    }

    if (client.sessionId !== sessionId) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Join the session before sending strokes' } });
      return;
    }

    const slide = await prisma.slide.findUnique({ where: { id: slideId } });
    if (!slide || slide.sessionId !== sessionId) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Slide not found' } });
      return;
    }

    const created = await prisma.stroke.create({
      data: {
        sessionId,
        slideId,
        payload: stroke as Prisma.InputJsonValue,
        createdById: client.userId
      }
    });

    this.broadcast(sessionId, {
      type: 'STROKE',
      payload: {
        stroke: serializeStroke(created)
      }
    });
  }

  private async handleClearSlide(socket: WebSocket, client: ClientMeta, sessionId: string, slideId: string) {
    if (!client.isAdmin) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Admin privileges required' } });
      return;
    }

    if (client.sessionId !== sessionId) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Join the session before clearing slides' } });
      return;
    }

    const slide = await prisma.slide.findUnique({ where: { id: slideId } });
    if (!slide || slide.sessionId !== sessionId) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Slide not found' } });
      return;
    }

    await prisma.stroke.deleteMany({ where: { slideId } });

    this.broadcast(sessionId, {
      type: 'CLEAR_SLIDE',
      payload: { slideId }
    });
  }

  private async handleChatMessage(socket: WebSocket, client: ClientMeta, sessionId: string, message: string) {
    if (client.sessionId !== sessionId) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Join the session before sending messages' } });
      return;
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Session not found' } });
      return;
    }

    if (!session.chatEnabled) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Chat is disabled for this session' } });
      return;
    }

    const chatMessage: ChatMessage = {
      id: randomUUID(),
      sessionId,
      userId: client.userId,
      email: client.email,
      message,
      timestamp: new Date().toISOString()
    };

    const history = this.chatMessages.get(sessionId) ?? [];
    history.push(chatMessage);
    if (history.length > 200) {
      history.shift();
    }
    this.chatMessages.set(sessionId, history);

    this.broadcast(sessionId, {
      type: 'CHAT_MESSAGE',
      payload: chatMessage
    });
  }

  private async handleChatToggle(socket: WebSocket, client: ClientMeta, sessionId: string, enabled: boolean) {
    if (!client.isAdmin) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Admin privileges required' } });
      return;
    }

    if (client.sessionId !== sessionId) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Join the session before updating chat' } });
      return;
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      this.send(socket, { type: 'ERROR', payload: { message: 'Session not found' } });
      return;
    }

    if (session.chatEnabled === enabled) {
      this.send(socket, {
        type: 'CHAT_ENABLE',
        payload: { sessionId, enabled }
      });
      return;
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: { chatEnabled: enabled }
    });

    this.broadcast(sessionId, {
      type: 'CHAT_ENABLE',
      payload: { sessionId, enabled }
    });
  }

  private leaveRoom(socket: WebSocket) {
    const client = this.clients.get(socket);
    if (!client?.sessionId) {
      return;
    }

    const room = this.rooms.get(client.sessionId);
    if (!room) {
      return;
    }

    room.delete(socket);
    if (room.size === 0) {
      this.rooms.delete(client.sessionId);
    }
  }

  private send(socket: WebSocket, message: OutgoingMessage) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  }
}

let managerInstance: WebSocketManager | null = null;

export const initializeWebSocketServer = (server: HttpServer) => {
  managerInstance = new WebSocketManager(server);
  return managerInstance;
};

export const getWebSocketManager = () => managerInstance;

export type { WebSocketManager };
