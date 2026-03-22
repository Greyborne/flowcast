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
import transactionsRouter from './routes/transactions';
import backupRouter from './routes/backup';

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
app.use('/api/transactions', transactionsRouter);
app.use('/api/backup', backupRouter);

// ── Error Handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── WebSocket Server ─────────────────────────────────────────────────────────
initWebSocketServer(httpServer);

// ── Schema Migrations (safe, idempotent) ────────────────────────────────────

/**
 * Applies lightweight column additions without touching existing data.
 * Each migration is a no-op if the column already exists.
 */
async function runMigrations() {
  // v2: add actualBalance to BalanceSnapshot (reconciled-actuals-only balance)
  try {
    await prisma.$executeRaw`ALTER TABLE "BalanceSnapshot" ADD COLUMN "actualBalance" REAL NOT NULL DEFAULT 0`;
    console.log('🔧 Migration: added actualBalance column to BalanceSnapshot');
  } catch {
    // Column already exists — this is expected on all subsequent startups
  }
}

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

  // Check if actualBalance column was just added (all zeros despite non-zero running balances)
  // This happens on the first restart after the schema migration that added actualBalance.
  if (snapshotCount > 0) {
    const needsRecompute = await prisma.balanceSnapshot.findFirst({
      where: { actualBalance: 0, runningBalance: { not: 0 } },
    });
    if (!needsRecompute) return;
    console.log('📐 Detected new actualBalance column — recomputing all balance snapshots...');
  } else {
    console.log('📐 No balance snapshots found — computing initial projections...');
  }

  const firstPeriod = await prisma.payPeriod.findFirst({ orderBy: { paydayDate: 'asc' } });
  if (!firstPeriod) return;

  const affected = await recomputeFromPeriod(firstPeriod.id);
  console.log(`✅ Computed ${affected.length} balance snapshots.\n`);
}

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.API_PORT) || 3001;
httpServer.listen(PORT, async () => {
  console.log(`\n🚀 FlowCast API running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server running on ws://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  await runMigrations();
  await ensureInstances();
  await ensureSnapshots();
});

export { httpServer };
