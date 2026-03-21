import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { computePeriodProjection, recomputeFromPeriod } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';

const router = Router();

// GET /api/pay-periods — list all pay periods with balance snapshots
router.get('/', async (_req: Request, res: Response) => {
  try {
    const periods = await prisma.payPeriod.findMany({
      orderBy: { paydayDate: 'asc' },
      include: { balanceSnapshot: true },
    });
    res.json(periods);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pay periods' });
  }
});

// GET /api/pay-periods/:id — get full projection for one pay period
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const snapshot = await prisma.balanceSnapshot.findUnique({
      where: { payPeriodId: req.params.id },
    });
    const openingBalance = snapshot?.runningBalance ?? 0;
    const projection = await computePeriodProjection(req.params.id, openingBalance);
    res.json(projection);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute period projection' });
  }
});

// GET /api/pay-periods/:id/close-preview
// Returns what will happen when the period is closed:
//   - income entries to auto-reconcile
//   - fixed bill instances to auto-reconcile
//   - active discretionary templates (user provides amounts)
//   - current running balance
router.get('/:id/close-preview', async (req: Request, res: Response) => {
  try {
    const [period, discretionaryTemplates] = await Promise.all([
      prisma.payPeriod.findUniqueOrThrow({
        where: { id: req.params.id },
        include: {
          billInstances: {
            include: { billTemplate: { select: { id: true, name: true, group: true, isDiscretionary: true, dueDayOfMonth: true, defaultAmount: true } } },
          },
          incomeEntries: {
            include: { incomeSource: { select: { id: true, name: true } } },
          },
          balanceSnapshot: true,
        },
      }),
      // Active templates with no due day (discretionary) — may or may not have instances
      prisma.billTemplate.findMany({
        where: { isActive: true, OR: [{ isDiscretionary: true }, { dueDayOfMonth: null }] },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    const instancedTemplateIds = new Set(period.billInstances.map((i) => i.billTemplateId));

    res.json({
      isClosed: period.isClosed,
      openingBalance: period.openingBalance,
      runningBalance: period.balanceSnapshot?.runningBalance ?? period.openingBalance,
      incomeToReconcile: period.incomeEntries
        .filter((e) => !e.isReconciled)
        .map((e) => ({ id: e.id, name: e.incomeSource.name, projectedAmount: e.projectedAmount })),
      incomeReconciled: period.incomeEntries
        .filter((e) => e.isReconciled)
        .map((e) => ({ id: e.id, name: e.incomeSource.name, actualAmount: e.actualAmount })),
      fixedToReconcile: period.billInstances
        .filter((i) => !i.isReconciled && !i.billTemplate.isDiscretionary && i.billTemplate.dueDayOfMonth !== null)
        .map((i) => ({ id: i.id, name: i.billTemplate.name, group: i.billTemplate.group, projectedAmount: i.projectedAmount })),
      fixedReconciled: period.billInstances
        .filter((i) => i.isReconciled && !i.billTemplate.isDiscretionary && i.billTemplate.dueDayOfMonth !== null)
        .map((i) => ({ id: i.id, name: i.billTemplate.name, group: i.billTemplate.group, actualAmount: i.actualAmount })),
      // Discretionary: templates not yet in this period, plus already-reconciled instances
      discretionaryTemplates: discretionaryTemplates
        .filter((t) => !instancedTemplateIds.has(t.id))
        .map((t) => ({ id: t.id, name: t.name, group: t.group, defaultAmount: t.defaultAmount })),
      discretionaryReconciled: period.billInstances
        .filter((i) => instancedTemplateIds.has(i.billTemplateId) && (i.billTemplate.isDiscretionary || i.billTemplate.dueDayOfMonth === null))
        .map((i) => ({ id: i.id, name: i.billTemplate.name, actualAmount: i.actualAmount, isReconciled: i.isReconciled })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pay-periods/:id/close
// Body: { discretionaryAmounts: { billTemplateId: string, amount: number }[] }
router.post('/:id/close', async (req: Request, res: Response) => {
  try {
    const { discretionaryAmounts = [] } = req.body as {
      discretionaryAmounts: { billTemplateId: string; amount: number }[];
    };

    const period = await prisma.payPeriod.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        billInstances: { include: { billTemplate: true } },
        incomeEntries: true,
      },
    });

    if (period.isClosed) {
      return res.status(400).json({ error: 'Period is already closed' });
    }

    // 1. Auto-reconcile all unreconciled income entries at projected amount
    const unreconciledIncome = period.incomeEntries.filter((e) => !e.isReconciled);
    if (unreconciledIncome.length > 0) {
      await prisma.incomeEntry.updateMany({
        where: { id: { in: unreconciledIncome.map((e) => e.id) } },
        data: { isReconciled: true, reconciledAt: new Date() },
      });
      // Set actualAmount for each (updateMany can't set per-row values)
      for (const entry of unreconciledIncome) {
        await prisma.incomeEntry.update({
          where: { id: entry.id },
          data: { actualAmount: entry.projectedAmount },
        });
      }
    }

    // 2. Auto-reconcile all unreconciled fixed bill instances at projected amount
    const fixedUnreconciled = period.billInstances.filter(
      (i) => !i.isReconciled && !i.billTemplate.isDiscretionary && i.billTemplate.dueDayOfMonth !== null,
    );
    for (const inst of fixedUnreconciled) {
      await prisma.billInstance.update({
        where: { id: inst.id },
        data: { isReconciled: true, isFrozen: true, actualAmount: inst.projectedAmount, reconciledAt: new Date() },
      });
    }

    // 3. Create/reconcile discretionary instances for user-provided amounts > 0
    for (const { billTemplateId, amount } of discretionaryAmounts) {
      if (amount <= 0) continue;
      const template = await prisma.billTemplate.findUnique({ where: { id: billTemplateId } });
      if (!template) continue;

      await prisma.billInstance.upsert({
        where: { payPeriodId_billTemplateId: { payPeriodId: period.id, billTemplateId } },
        create: {
          payPeriodId: period.id,
          billTemplateId,
          projectedAmount: amount,
          actualAmount: amount,
          isReconciled: true,
          isFrozen: true,
          reconciledAt: new Date(),
        },
        update: {
          actualAmount: amount,
          isReconciled: true,
          isFrozen: true,
          reconciledAt: new Date(),
        },
      });
    }

    // 4. Mark the period as closed
    await prisma.payPeriod.update({
      where: { id: req.params.id },
      data: { isClosed: true },
    });

    // 5. Recompute from this period — running balance becomes accurate closing balance
    const affectedIds = await recomputeFromPeriod(req.params.id);

    // 6. Carry the actual closing balance forward to the next period's opening balance
    const closingSnapshot = await prisma.balanceSnapshot.findUnique({
      where: { payPeriodId: req.params.id },
    });
    if (closingSnapshot) {
      const nextPeriod = await prisma.payPeriod.findFirst({
        where: { paydayDate: { gt: period.paydayDate } },
        orderBy: { paydayDate: 'asc' },
      });
      if (nextPeriod) {
        await prisma.payPeriod.update({
          where: { id: nextPeriod.id },
          data: { openingBalance: closingSnapshot.runningBalance },
        });
        const moreAffected = await recomputeFromPeriod(nextPeriod.id);
        moreAffected.forEach((id) => { if (!affectedIds.includes(id)) affectedIds.push(id); });
      }
    }

    broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    res.json({ success: true, affectedIds });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pay-periods/:id/reopen — unlock a closed period
router.post('/:id/reopen', async (req: Request, res: Response) => {
  try {
    await prisma.payPeriod.update({
      where: { id: req.params.id },
      data: { isClosed: false },
    });
    const affected = await recomputeFromPeriod(req.params.id);
    broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affected });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
