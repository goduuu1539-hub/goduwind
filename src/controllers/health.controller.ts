import { Request, Response } from 'express';
import { success } from '../utils/response';
import { config } from '../config/env';

export function healthCheck(_req: Request, res: Response) {
  return success(res, {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    env: config.env,
  });
}
