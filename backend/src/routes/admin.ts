import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { recomputeFromPeriod } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';

const router = Router();

type ClearTarget =
  | 'reconciliations'
  | 'instances'
  | 'snapshots'
  | 'templates'
  | 'sources'
  | 'periods';

/**
 * POST /api/admin/clear
 * Body: { targets: ClearTarget[] }
 *
 * Clears the requested data segments in a safe dependency order.
 * Returns a summary of what was deleted/modified.
 */
router.post('/clear', async (req: Request, res: Response) => {
  try {
    const { targets } = req.body as { targets: ClearTarget[] };
    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'targets array is required and must not be empty' });
    }

    const valid: ClearTarget[] = ['reconciliations', 'instances', 'snapshots', 'templates', 'sources', 'periods'];
    const invalid = targets.filter((t) => !valid.includes(t));
    if (invalid.length) {
      return res.status(400).json({ error: `Unknown targets: ${invalid.join(', ')}` });
    }

    const summary: Record<string, number> = {};

    // ── 1. Reconciliations — un-reconcile all items, wipe logs, unlink transactions ──
    if (targets.includes('reconciliations')) {
      const [bills, entries, txns, logs] = await Promise.all([
        prisma.billInstance.updateMany({
          where: { isReconciled: true },
          data: { isReconciled: false, isFrozen: false, actualAmount: null, reconciledAt: null },
        }),
        prisma.incomeEntry.updateMany({
          where: { isReconciled: true },
          data: { isReconciled: false, actualAmount: null, reconciledAt: null },
        }),
        prisma.transaction.updateMany({
          where: { status: 'MATCHED' },
          data: { status: 'UNMATCHED', billInstanceId: null, incomeEntryId: null },
        }),
        prisma.reconciliationLog.deleteMany({}),
      ]);
      summary.billsUnreconciled = bills.count;
      summary.incomeUnreconciled = entries.count;
      summary.transactionsUnmatched = txns.count;
      summary.logsDeleted = logs.count;
    }

    // ── 2. Periods — cascades everything (instances, entries, snapshots, logs) ─
    if (targets.includes('periods')) {
      // ReconciliationLog has no FK — must delete manually first
      const logs = await prisma.reconciliationLog.deleteMany({});
      const periods = await prisma.payPeriod.deleteMany({});
      summary.periodsDeleted = periods.count;
      summary.logsDeletedWithPeriods = logs.count;
      // Nothing left to recompute — broadcast empty
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: [] });
      return res.json({ success: true, summary });
    }

    // ── 3. Templates — cascades BillInstances and BillMonthlyAmounts ──────────
    if (targets.includes('templates')) {
      await prisma.reconciliationLog.deleteMany({ where: { resourceType: 'bill' } });
      const templates = await prisma.billTemplate.deleteMany({});
      summary.templatesDeleted = templates.count;
      // BillInstances cascade-deleted via FK
    }

    // ── 4. Sources — cascades IncomeEntries ───────────────────────────────────
    if (targets.includes('sources')) {
      await prisma.reconciliationLog.deleteMany({ where: { resourceType: 'income' } });
      const sources = await prisma.incomeSource.deleteMany({});
      summary.sourcesDeleted = sources.count;
      // IncomeEntries cascade-deleted via FK
    }

    // ── 5. Instances — delete all bill instances + income entries ─────────────
    if (targets.includes('instances') && !targets.includes('templates') && !targets.includes('sources')) {
      await prisma.reconciliationLog.deleteMany({});
      const [bills, income] = await Promise.all([
        prisma.billInstance.deleteMany({}),
        prisma.incomeEntry.deleteMany({}),
      ]);
      summary.instancesDeleted = bills.count;
      summary.entriesDeleted = income.count;
    }

    // ── 6. Snapshots — wipe balance history ───────────────────────────────────
    if (targets.includes('snapshots')) {
      const snaps = await prisma.balanceSnapshot.deleteMany({});
      summary.snapshotsDeleted = snaps.count;
    }

    // ── Recompute projections if periods still exist ───────────────────────────
    const firstPeriod = await prisma.payPeriod.findFirst({ orderBy: { paydayDate: 'asc' } });
    if (firstPeriod) {
      const affected = await recomputeFromPeriod(firstPeriod.id);
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affected });
      summary.periodsRecomputed = affected.length;
    } else {
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: [] });
    }

    res.json({ success: true, summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Clear operation failed' });
  }
});

export default router;
