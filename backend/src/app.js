import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import adminRoutes from './routes/admin.routes.js';
import consumerRoutes from './routes/consumer.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

app.set('trust proxy', env.trustProxy);

app.use(helmet());

app.use(cors({
  origin: env.corsOrigins === '*' ? '*' : env.corsOrigins.split(',').map((o) => o.trim()),
}));

app.use(express.json({ limit: '100kb' }));

// Request log with the device key hidden
morgan.token('safe-url', (req) => req.originalUrl.replace(/([?&]key=)[^&]+/i, '$1***'));
app.use(morgan(':method :safe-url :status :response-time ms'));

app.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', time: new Date().toISOString() });
});

app.use('/admin', adminRoutes);
app.use('/consumer', consumerRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
