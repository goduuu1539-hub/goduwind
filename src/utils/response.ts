import { Response } from 'express';

export interface ApiErrorBody {
  message: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: ApiErrorBody;
  meta?: Record<string, unknown>;
}

export function success<T = unknown>(
  res: Response,
  data?: T,
  message = 'OK',
  status = 200,
  meta?: Record<string, unknown>,
) {
  const body: ApiResponse<T> = {
    success: true,
    message,
    data,
  };
  if (meta && Object.keys(meta).length) body.meta = meta;
  return res.status(status).json(body);
}

export function failure(
  res: Response,
  message = 'Internal Server Error',
  status = 500,
  details?: unknown,
) {
  const body: ApiResponse = {
    success: false,
    message,
    error: {
      message,
      details,
    },
  };
  return res.status(status).json(body);
}
