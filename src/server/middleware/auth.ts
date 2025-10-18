import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { UnauthorizedError } from '../utils/httpError';

type TokenPayload = {
  sub?: string;
  userId?: string;
};

export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authorization = req.headers.authorization;
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authorization header is required');
    }

    const token = authorization.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedError('Authorization token is required');
    }

    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    const userId = payload.sub ?? payload.userId;

    if (!userId) {
      throw new UnauthorizedError('Invalid token payload');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedError('Invalid or expired token');
    }

    req.user = {
      id: user.id,
      email: user.email
    };
    req.token = token;

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
      return;
    }

    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Invalid or expired token'));
      return;
    }

    next(error);
  }
};
