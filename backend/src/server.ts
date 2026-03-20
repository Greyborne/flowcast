import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { initWebSocketServer } from './websocket/wsServer';
import { errorHandler } from './middleware/errorHandler';
import prisma from './models/prisma';
import { recomputeFromPeriod, billFallsInPeriod } from './services/projectionEngine';

// Routes
import payPeriodsRouter from './routes/payPeriods';
import billsRouter from './routes/bills';
import incomeRouter from './routes/income';
import reconciliationRouter from './routes/reconciliation';
import settingsRouter from './routes/settings';
import adminRouter from './routes/admin';

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
app.use('/api/admin', adminRouter);

// ── Error Handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── WebSocket Server ─────────────────────────────────────────────────────────
initWebSocketServer(httpServer);

// ── Initial Projection Compute ───────────────────────────────────────────────

/**
 * Materializes BillInstance and IncomeEntry rows for all pay periods.
 * Only runs once — skipped if instances already exist.
 */
async function ensureInstances() {
  const existingCount = await prisma.billInstance.count();
  if (existingCount > 0) return;

  console.log('🔨 Materializing bill instances and income entries...');

  const [periods, billTemplates, incomeSources] = await Promise.all([
    prisma.payPeriod.findMany({ orderBy: { paydayDate: 'asc' } }),
    prisma.billTemplate.findMany({ where: { isActive: true } }),
    prisma.incomeSource.findMany({ where: { isActive: true } }),
  ]);

  let billCount = 0;
  let incomeCount = 0;

  for (const period of periods) {
    // Bill instances: assign bills with a due day using billFallsInPeriod logic
    for (const template of billTemplates) {
      if (template.dueDayOfMonth == null) continue; // discretionary/savings: skip
      if (!billFallsInPeriod(template.dueDayOfMonth, period.startDate, period.endDate)) continue;

      await prisma.billInstance.upsert({
        where: { payPeriodId_billTemplateId: { payPeriodId: period.id, billTemplateId: template.id } },
        create: {
          payPeriodId: period.id,
          billTemplateId: template.id,
          projectedAmount: template.defaultAmount,
        },
        update: {},
      });
      billCount++;
    }

    // Income entries: W2 gets one entry per period; MONTHLY_RECURRING gets one per period
    for (const source of incomeSources) {
      if (source.type === 'AD_HOC') continue;

      await prisma.incomeEntry.upsert({
        where: { payPeriodId_incomeSourceId: { payPeriodId: period.id, incomeSourceId: source.id } },
        create: {
          payPeriodId: period.id,
          incomeSourceId: source.id,
          projectedAmount: source.defaultAmount,
        },
        update: {},
      });
      incomeCount++;
    }
  }

  // Wipe any snapshots that may have been computed before instances existed (all zeros)
  await prisma.balanceSnapshot.deleteMany({});

  console.log(`✅ Created ${billCount} bill instances, ${incomeCount} income entries.\n`);
}

async function ensureSnapshots() {
  const snapshotCount = await prisma.balanceSnapshot.count();
  if (snapshotCount > 0) return;

  const firstPeriod = await prisma.payPeriod.findFirst({ orderBy: { paydayDate: 'asc' } });
  if (!firstPeriod) return;

  console.log('📐 No balance snapshots found — computing initial projections...');
  const affected = await recomputeFromPeriod(firstPeriod.id);
  console.log(`✅ Computed ${affected.length} balance snapshots.\n`);
}

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.API_PORT) || 3001;
httpServer.listen(PORT, async () => {
  console.log(`\n🚀 FlowCast API running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server running on ws://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  await ensureInstances();
  await ensureSnapshots();
});

export { httpServer };
