import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError';

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
  }

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: error.message
    });
  }

  console.error('Unhandled error:', error);
  return res.status(500).json({ error: 'Internal Server Error' });
};
