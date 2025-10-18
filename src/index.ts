import http from 'http';
import app from './server/app';
import { env } from './server/config/env';
import { initializeWebSocketServer } from './ws/server';

const server = http.createServer(app);

initializeWebSocketServer(server);

server.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});

const shutdown = (signal: NodeJS.Signals) => {
  console.info(`Received ${signal}. Shutting down gracefully.`);
  server.close(() => {
    console.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});
