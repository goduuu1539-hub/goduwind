import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationMs = durationNs / 1_000_000;
    const { statusCode } = res;
    const contentLength = res.getHeader('content-length') || 0;
    logger.info(`${method} ${originalUrl} ${statusCode} ${contentLength} - ${durationMs.toFixed(2)}ms`);
  });

  next();
}
