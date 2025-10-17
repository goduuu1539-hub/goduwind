import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type Env = 'development' | 'test' | 'production';

function requireEnv(name: string, validator?: (v: string) => boolean, hint?: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}${hint ? ` (${hint})` : ''}`);
  }
  if (validator && !validator(value)) {
    throw new Error(`Invalid value for ${name}${hint ? ` (${hint})` : ''}`);
  }
  return value;
}

const NODE_ENV = (process.env.NODE_ENV as Env) || 'development';
const PORT = Number(process.env.PORT || 3000);

const DATABASE_URL = requireEnv(
  'DATABASE_URL',
  (v) => v.includes('://') && v.length > 10,
  'expected a connection string like protocol://...'
);

const JWT_SECRET = requireEnv('JWT_SECRET', (v) => v.length >= 16, 'should be at least 16 characters');

const AWS_ACCESS_KEY_ID = requireEnv('AWS_ACCESS_KEY_ID');
const AWS_SECRET_ACCESS_KEY = requireEnv('AWS_SECRET_ACCESS_KEY');
const AWS_REGION = requireEnv('AWS_REGION');

export const config = {
  env: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  port: PORT,
  databaseUrl: DATABASE_URL,
  jwtSecret: JWT_SECRET,
  aws: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    region: AWS_REGION,
  },
};

export type AppConfig = typeof config;
