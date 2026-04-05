import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { initWebSocketServer } from './websocket/wsServer';
import { errorHandler } from './middleware/errorHandler';
import { accountMiddleware, initAccountCache, acctKey } from './middleware/accountContext';
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
import accountsRouter from './routes/accounts';

const app = express();
const httpServer = createServer(app);

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

// ── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Accounts (no account middleware — used to list/create accounts) ───────────
app.use('/api/accounts', accountsRouter);

// ── Account context middleware — applies to all other API routes ──────────────
// Reads X-Account-Id header; falls back to "personal" for backward compat.
app.use('/api', accountMiddleware);

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
 * Applies lightweight schema additions without touching existing data.
 * Each migration is a no-op if the column/table already exists.
 * Order matters: Account table must exist before accountId columns are added.
 */
async function runMigrations() {
  // v1: actualBalance column on BalanceSnapshot
  try {
    await prisma.$executeRaw`ALTER TABLE "BalanceSnapshot" ADD COLUMN "actualBalance" REAL NOT NULL DEFAULT 0`;
    console.log('🔧 Migration v1: added actualBalance to BalanceSnapshot');
  } catch { /* already exists */ }

  // v2: Phase 5 — Account table
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Account" (
        "id"         TEXT     NOT NULL PRIMARY KEY,
        "name"       TEXT     NOT NULL,
        "color"      TEXT     NOT NULL DEFAULT 'blue',
        "periodType" TEXT     NOT NULL DEFAULT 'biweekly',
        "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('🔧 Migration v2: created Account table');
  } catch { /* already exists */ }

  // v2a: Insert the default "Personal" account (idempotent)
  try {
    await prisma.$executeRaw`
      INSERT OR IGNORE INTO "Account" ("id", "name", "color", "periodType", "createdAt")
      VALUES ('personal', 'Personal', 'blue', 'biweekly', CURRENT_TIMESTAMP)
    `;
  } catch { /* already inserted */ }

  // v2b: Add accountId to all data tables (DEFAULT 'personal' backfills existing rows)
  const tablesNeedingAccountId = [
    'PayPeriod', 'IncomeSource', 'IncomeEntry', 'BillTemplate',
    'BillMonthlyAmount', 'BillInstance', 'BalanceSnapshot',
    'ReconciliationLog', 'ImportBatch', 'Transaction', 'AutoMatchRule',
  ];

  for (const table of tablesNeedingAccountId) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "accountId" TEXT NOT NULL DEFAULT 'personal'`
      );
      console.log(`🔧 Migration v2b: added accountId to ${table}`);
    } catch { /* column already exists */ }
  }

  // v2c: Add expectedDayOfMonth to IncomeSource
  try {
    await prisma.$executeRaw`ALTER TABLE "IncomeSource" ADD COLUMN "expectedDayOfMonth" INTEGER`;
    console.log('🔧 Migration v2c: added expectedDayOfMonth to IncomeSource');
  } catch { /* already exists */ }

  // v2d: Migrate AppSetting keys to account-prefixed format (e.g. "billGroups" → "personal:billGroups")
  // Only migrates keys that don't already contain a colon (not yet prefixed).
  try {
    const count = await prisma.$executeRaw`
      UPDATE "AppSetting"
      SET "key" = 'personal:' || "key"
      WHERE "key" NOT LIKE '%:%'
    `;
    if (count > 0) console.log(`🔧 Migration v2d: prefixed ${count} AppSetting keys with 'personal:'`);
  } catch (err) {
    console.error('Migration v2d failed:', err);
  }
}

// ── Initial Projection Compute ───────────────────────────────────────────────
/**
 * Materializes BillInstance and IncomeEntry rows for all pay periods.
 * Now account-scoped: iterates each account's periods and templates separately.
 */
async function ensureInstances() {
  // Only runs if NO instances exist at all (fresh DB)
  const existingCount = await prisma.billInstance.count();
  if (existingCount > 0) return;

  console.log('🔨 Materializing bill instances and income entries...');

  const accounts = await prisma.account.findMany();
  let totalBills = 0;
  let totalIncome = 0;

  for (const account of accounts) {
    const [periods, billTemplates, incomeSources] = await Promise.all([
      prisma.payPeriod.findMany({ where: { accountId: account.id }, orderBy: { paydayDate: 'asc' } }),
      prisma.billTemplate.findMany({ where: { accountId: account.id, isActive: true } }),
      prisma.incomeSource.findMany({ where: { accountId: account.id, isActive: true } }),
    ]);

    for (const period of periods) {
      for (const template of billTemplates) {
        if (template.dueDayOfMonth == null) continue;
        if (!billFallsInPeriod(template.dueDayOfMonth, period.startDate, period.endDate)) continue;

        await prisma.billInstance.upsert({
          where: { payPeriodId_billTemplateId: { payPeriodId: period.id, billTemplateId: template.id } },
          create: { accountId: account.id, payPeriodId: period.id, billTemplateId: template.id, projectedAmount: template.defaultAmount },
          update: {},
        });
        totalBills++;
      }

      for (const source of incomeSources) {
        if (source.type === 'AD_HOC') continue;
        await prisma.incomeEntry.upsert({
          where: { payPeriodId_incomeSourceId: { payPeriodId: period.id, incomeSourceId: source.id } },
          create: { accountId: account.id, payPeriodId: period.id, incomeSourceId: source.id, projectedAmount: source.defaultAmount },
          update: {},
        });
        totalIncome++;
      }
    }
  }

  await prisma.balanceSnapshot.deleteMany({});
  console.log(`✅ Created ${totalBills} bill instances, ${totalIncome} income entries.\n`);
}

async function ensureSnapshots() {
  const snapshotCount = await prisma.balanceSnapshot.count();

  if (snapshotCount > 0) {
    const needsRecompute = await prisma.balanceSnapshot.findFirst({
      where: { actualBalance: 0, runningBalance: { not: 0 } },
    });
    if (!needsRecompute) return;
    console.log('📐 Detected new actualBalance column — recomputing all balance snapshots...');
  } else {
    console.log('📐 No balance snapshots found — computing initial projections...');
  }

  // Recompute for each account's first period
  const accounts = await prisma.account.findMany();
  let total = 0;

  for (const account of accounts) {
    const firstPeriod = await prisma.payPeriod.findFirst({
      where: { accountId: account.id },
      orderBy: { paydayDate: 'asc' },
    });
    if (!firstPeriod) continue;

    const affected = await recomputeFromPeriod(firstPeriod.id);
    total += affected.length;
  }

  console.log(`✅ Computed ${total} balance snapshots.\n`);
}

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.API_PORT) || 3001;
httpServer.listen(PORT, async () => {
  console.log(`\n🚀 FlowCast API running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server running on ws://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  await runMigrations();
  await initAccountCache();       // Prime the in-memory account ID cache
  await ensureInstances();
  await ensureSnapshots();
});

export { httpServer };
