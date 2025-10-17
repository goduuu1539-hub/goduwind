import app from './app';
import { config } from './config/env';
import { logger } from './utils/logger';

const server = app.listen(config.port, () => {
  logger.info(`Server listening on port ${config.port}`);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { err: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason });
  server.close(() => process.exit(1));
});
