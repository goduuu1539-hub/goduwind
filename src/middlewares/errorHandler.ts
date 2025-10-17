import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { failure } from '../utils/response';

export class ApiError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export function errorHandler(
  err: Error | ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status = (err as ApiError).statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error(message, {
    status,
    name: err.name,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });

  return failure(
    res,
    message,
    status,
    process.env.NODE_ENV === 'production' ? undefined : (err as ApiError).details || err.stack,
  );
}
