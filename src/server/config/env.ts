import path from 'path';
import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .default('postgresql://postgres:postgres@localhost:5432/livestream'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required').default('change-me'),
  ASSET_BASE_URL: z
    .string()
    .url('ASSET_BASE_URL must be a valid URL')
    .optional(),
  UPLOAD_DIR: z.string().min(1).default('uploads')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

const data = parsed.data;
const uploadsPath = path.isAbsolute(data.UPLOAD_DIR)
  ? data.UPLOAD_DIR
  : path.resolve(process.cwd(), data.UPLOAD_DIR);

const normalizedAssetBaseUrl = (data.ASSET_BASE_URL ?? `http://localhost:${data.PORT}`).replace(/\/$/, '');

export const env = {
  NODE_ENV: data.NODE_ENV ?? 'development',
  PORT: data.PORT,
  DATABASE_URL: data.DATABASE_URL,
  JWT_SECRET: data.JWT_SECRET,
  ASSET_BASE_URL: normalizedAssetBaseUrl,
  UPLOAD_DIR: uploadsPath
};

export const publicPaths = {
  uploads: '/uploads',
  static: '/static'
};
