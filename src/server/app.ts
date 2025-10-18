import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import routes from './routes';
import { env, publicPaths } from './config/env';
import { errorHandler } from './middleware/errorHandler';

const app = express();

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const staticDir = path.resolve(process.cwd(), 'public');
if (fs.existsSync(staticDir)) {
  app.use(publicPaths.static, express.static(staticDir));
}

app.use(publicPaths.uploads, express.static(env.UPLOAD_DIR));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1', routes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use(errorHandler);

export default app;
