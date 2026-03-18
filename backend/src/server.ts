import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { initWebSocketServer } from './websocket/wsServer';
import { errorHandler } from './middleware/errorHandler';

// Routes
import payPeriodsRouter from './routes/payPeriods';
import billsRouter from './routes/bills';
import incomeRouter from './routes/income';
import reconciliationRouter from './routes/reconciliation';
import settingsRouter from './routes/settings';

const app = express();
const httpServer = createServer(app);

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

// ── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/pay-periods', payPeriodsRouter);
app.use('/api/bills', billsRouter);
app.use('/api/income', incomeRouter);
app.use('/api/reconciliation', reconciliationRouter);
app.use('/api/settings', settingsRouter);

// ── Error Handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── WebSocket Server ─────────────────────────────────────────────────────────
initWebSocketServer(httpServer);

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.API_PORT) || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 FlowCast API running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server running on ws://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

export { httpServer };
