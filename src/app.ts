import express from 'express';
import routes from './routes';
import { requestLogger } from './middlewares/logger';
import { notFound } from './middlewares/notFound';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(requestLogger);

app.use('/', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
