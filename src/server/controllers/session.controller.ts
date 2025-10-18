import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { Prisma, Session, SessionStatus, SlideType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError
} from '../utils/httpError';
import { generateSessionId } from '../utils/sessionId';
import { getWebSocketManager } from '../../ws/server';
import { serializeSession, serializeSlide, serializeStroke, SlideResponse } from '../utils/serializers';

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(1000).optional()
});

const emptySlideSchema = z.object({
  title: z.string().trim().max(255).optional()
});

type SessionWithSlides = Prisma.SessionGetPayload<{
  include: { slides: true };
}>;

type SlidesPayload = {
  sessionId: string;
  currentSlideId: string | null;
  slides: SlideResponse[];
};



function requireUser(req: Request): Express.AuthenticatedUser {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  return req.user;
}

async function getOwnedSession(sessionId: string, userId: string, options: { includeSlides: true }): Promise<SessionWithSlides>;
async function getOwnedSession(sessionId: string, userId: string, options?: { includeSlides?: false }): Promise<Session>;
async function getOwnedSession(
  sessionId: string,
  userId: string,
  options?: { includeSlides?: boolean }
): Promise<Session | SessionWithSlides> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: options?.includeSlides
      ? { slides: { orderBy: { order: 'asc' } } }
      : undefined
  });

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  if (session.ownerId !== userId) {
    throw new ForbiddenError('You do not have access to this session');
  }

  return session;
}

async function getSlidesPayload(sessionId: string): Promise<SlidesPayload> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { slides: { orderBy: { order: 'asc' } } }
  });

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  return {
    sessionId: session.id,
    currentSlideId: session.currentSlideId,
    slides: session.slides.map(serializeSlide)
  };
}

function broadcastSessionEvent(sessionId: string, type: string, payload: Record<string, unknown>) {
  const manager = getWebSocketManager();
  if (manager) {
    manager.broadcast(sessionId, { type, payload });
  }
}

function broadcastSlideUpdate(payload: SlidesPayload) {
  const manager = getWebSocketManager();
  if (manager) {
    manager.broadcast(payload.sessionId, { type: 'SLIDE_CHANGED', payload });
  }
}

async function respondWithSlides(res: Response, sessionId: string, status: number) {
  const payload = await getSlidesPayload(sessionId);
  res.status(status).json(payload);
  broadcastSlideUpdate(payload);
}

async function removeFileIfExists(filePath: string | null | undefined) {
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      console.warn(`Failed to delete file ${filePath}: ${err.message}`);
    }
  }
}

function resolveTitle(input: unknown, fallback: string) {
  if (typeof input === 'string') {
    const value = input.trim();
    if (value.length > 0) {
      return value;
    }
  }
  return fallback;
}

export const createSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = requireUser(req);
    const payload = createSessionSchema.parse(req.body ?? {});

    let sessionId = '';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generateSessionId();
      const existing = await prisma.session.findUnique({ where: { id: candidate } });
      if (!existing) {
        sessionId = candidate;
        break;
      }
    }

    if (!sessionId) {
      throw new ConflictError('Unable to generate unique session identifier');
    }

    await prisma.session.create({
      data: {
        id: sessionId,
        title: payload.title ?? 'Untitled session',
        description: payload.description ?? null,
        ownerId: user.id,
        status: SessionStatus.DRAFT,
        chatEnabled: true
      }
    });

    res.status(201).json({ sessionId });
  } catch (error) {
    next(error);
  }
};

export const listSessions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = requireUser(req);
    const sessions = await prisma.session.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { slides: { orderBy: { order: 'asc' } } }
    });

    res.json(sessions.map(serializeSession));
  } catch (error) {
    next(error);
  }
};

export const startSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = requireUser(req);
    const sessionId = req.params.sessionId;
    const session = await getOwnedSession(sessionId, user.id, { includeSlides: true });

    if (session.status === SessionStatus.LIVE) {
      throw new BadRequestError('Session already started');
    }

    if (session.status === SessionStatus.ENDED) {
      throw new BadRequestError('Session already ended');
    }

    const updateData: Prisma.SessionUpdateInput = {
      status: SessionStatus.LIVE,
      startedAt: new Date(),
      endedAt: null
    };

    if (!session.currentSlideId && session.slides.length > 0) {
      updateData.currentSlideId = session.slides[0].id;
    }

    const updated = await prisma.session.update({
      where: { id: session.id },
      data: updateData,
      include: { slides: { orderBy: { order: 'asc' } } }
    });

    res.json(serializeSession(updated));

    broadcastSessionEvent(updated.id, 'SESSION_STARTED', {
      sessionId: updated.id,
      startedAt: updated.startedAt?.toISOString() ?? null
    });

    broadcastSlideUpdate({
      sessionId: updated.id,
      currentSlideId: updated.currentSlideId,
      slides: updated.slides.map(serializeSlide)
    });
  } catch (error) {
    next(error);
  }
};

export const endSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = requireUser(req);
    const sessionId = req.params.sessionId;
    const session = await getOwnedSession(sessionId, user.id, { includeSlides: true });

    if (session.status !== SessionStatus.LIVE) {
      throw new BadRequestError('Session is not live');
    }

    const updated = await prisma.session.update({
      where: { id: session.id },
      data: {
        status: SessionStatus.ENDED,
        endedAt: new Date()
      },
      include: { slides: { orderBy: { order: 'asc' } } }
    });

    res.json(serializeSession(updated));

    broadcastSessionEvent(updated.id, 'SESSION_ENDED', {
      sessionId: updated.id,
      endedAt: updated.endedAt?.toISOString() ?? null
    });
  } catch (error) {
    next(error);
  }
};

export const createPdfSlide = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = requireUser(req);
    const sessionId = req.params.sessionId;
    const session = await getOwnedSession(sessionId, user.id, { includeSlides: true });

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      throw new BadRequestError('PDF file is required');
    }

    if (file.mimetype !== 'application/pdf') {
      await removeFileIfExists(file.path);
      throw new BadRequestError('Only PDF files are allowed');
    }

    const title = resolveTitle((req.body ?? {}).title, file.originalname);

    const newSlide = await prisma.slide.create({
      data: {
        sessionId: session.id,
        type: SlideType.PDF,
        title,
        assetFilename: file.filename,
        assetOriginalName: file.originalname,
        assetMimeType: file.mimetype,
        assetSize: file.size,
        order: session.slides.length
      }
    });

    if (!session.currentSlideId) {
      await prisma.session.update({
        where: { id: session.id },
        data: { currentSlideId: newSlide.id }
      });
    }

    await respondWithSlides(res, session.id, 201);
  } catch (error) {
    next(error);
  }
};

export const createImageSlide = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = requireUser(req);
    const sessionId = req.params.sessionId;
    const session = await getOwnedSession(sessionId, user.id, { includeSlides: true });

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      throw new BadRequestError('Image file is required');
    }

    if (!file.mimetype.startsWith('image/')) {
      await removeFileIfExists(file.path);
      throw new BadRequestError('Only image files are allowed');
    }

    const title = resolveTitle((req.body ?? {}).title, file.originalname);

    const newSlide = await prisma.slide.create({
      data: {
        sessionId: session.id,
        type: SlideType.IMAGE,
        title,
        assetFilename: file.filename,
        assetOriginalName: file.originalname,
        assetMimeType: file.mimetype,
        assetSize: file.size,
        order: session.slides.length
      }
    });

    if (!session.currentSlideId) {
      await prisma.session.update({
        where: { id: session.id },
        data: { currentSlideId: newSlide.id }
      });
    }

    await respondWithSlides(res, session.id, 201);
  } catch (error) {
    next(error);
  }
};

export const createEmptySlide = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = requireUser(req);
    const sessionId = req.params.sessionId;
    const session = await getOwnedSession(sessionId, user.id, { includeSlides: true });

    const { title } = emptySlideSchema.parse(req.body ?? {});

    const slide = await prisma.slide.create({
      data: {
        sessionId: session.id,
        type: SlideType.EMPTY,
        title: title ?? 'Untitled slide',
        order: session.slides.length
      }
    });

    if (!session.currentSlideId) {
      await prisma.session.update({
        where: { id: session.id },
        data: { currentSlideId: slide.id }
      });
    }

    await respondWithSlides(res, session.id, 201);
  } catch (error) {
    next(error);
  }
};

export const deleteSlide = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = requireUser(req);
    const sessionId = req.params.sessionId;
    const slideId = req.params.slideId;
    const session = await getOwnedSession(sessionId, user.id, { includeSlides: true });

    const slide = session.slides.find((item) => item.id === slideId);
    if (!slide) {
      throw new NotFoundError('Slide not found');
    }

    const fileToRemove = slide.assetFilename ? path.join(env.UPLOAD_DIR, slide.assetFilename) : null;

    await prisma.$transaction(async (tx) => {
      await tx.stroke.deleteMany({ where: { slideId } });
      await tx.slide.delete({ where: { id: slideId } });

      const remainingSlides = await tx.slide.findMany({
        where: { sessionId },
        orderBy: { order: 'asc' }
      });

      await Promise.all(
        remainingSlides.map((item, index) =>
          item.order === index
            ? Promise.resolve()
            : tx.slide.update({ where: { id: item.id }, data: { order: index } })
        )
      );

      if (session.currentSlideId === slideId) {
        const nextSlideId = remainingSlides[0]?.id ?? null;
        await tx.session.update({
          where: { id: sessionId },
          data: { currentSlideId: nextSlideId }
        });
      }
    });

    if (fileToRemove) {
      await removeFileIfExists(fileToRemove);
    }

    await respondWithSlides(res, sessionId, 200);
  } catch (error) {
    next(error);
  }
};

export const getSessionState = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = requireUser(req);
    const sessionId = req.params.sessionId;
    const session = await getOwnedSession(sessionId, user.id, { includeSlides: true });

    const slides = session.slides.map(serializeSlide);
    const strokes = session.currentSlideId
      ? await prisma.stroke.findMany({
          where: { sessionId: session.id, slideId: session.currentSlideId },
          orderBy: { createdAt: 'asc' }
        })
      : [];

    res.json({
      sessionId: session.id,
      currentSlideId: session.currentSlideId,
      slides,
      strokes: strokes.map(serializeStroke)
    });
  } catch (error) {
    next(error);
  }
};
