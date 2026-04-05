import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { recomputeFromPeriod } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';

const router = Router();

// GET /api/income
router.get('/', async (req: Request, res: Response) => {
  try {
    const sources = await prisma.incomeSource.findMany({ where: { accountId: req.accountId }, orderBy: { sortOrder: 'asc' } });
    res.json(sources);
  } catch { res.status(500).json({ error: 'Failed to fetch income sources' }); }
});

// GET /api/income/grid
router.get('/grid', async (req: Request, res: Response) => {
  try {
    const [sources, entries] = await Promise.all([
      prisma.incomeSource.findMany({ where: { accountId: req.accountId, isActive: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.incomeEntry.findMany({
        where: { accountId: req.accountId },
        select: { id: true, payPeriodId: true, incomeSourceId: true, projectedAmount: true, actualAmount: true, isReconciled: true, notes: true },
      }),
    ]);

    const entryMap: Record<string, Record<string, (typeof entries)[0]>> = {};
    for (const entry of entries) {
      if (!entryMap[entry.incomeSourceId]) entryMap[entry.incomeSourceId] = {};
      entryMap[entry.incomeSourceId][entry.payPeriodId] = entry;
    }

    res.json({ sources, entryMap });
  } catch { res.status(500).json({ error: 'Failed to fetch income grid' }); }
});

// PATCH /api/income/entry/:id
router.patch('/entry/:id', async (req: Request, res: Response) => {
  try {
    const { projectedAmount, cascade = true } = req.body;
    if (typeof projectedAmount !== 'number') return res.status(400).json({ error: 'projectedAmount (number) is required' });

    const entry = await prisma.incomeEntry.findUniqueOrThrow({ where: { id: req.params.id }, include: { payPeriod: true } });
    if (entry.isReconciled) return res.status(400).json({ error: 'Cannot update a reconciled entry' });

    await prisma.incomeEntry.update({ where: { id: req.params.id }, data: { projectedAmount } });

    if (cascade) {
      const future = await prisma.incomeEntry.findMany({
        where: { accountId: req.accountId, incomeSourceId: entry.incomeSourceId, isReconciled: false, payPeriod: { paydayDate: { gt: entry.payPeriod.paydayDate } } },
      });
      if (future.length > 0) {
        await prisma.incomeEntry.updateMany({ where: { id: { in: future.map((e) => e.id) } }, data: { projectedAmount } });
      }
      await prisma.incomeSource.update({ where: { id: entry.incomeSourceId }, data: { defaultAmount: projectedAmount } });
    }

    const affectedIds = await recomputeFromPeriod(entry.payPeriodId);
    broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

async function reorderIncome(sourceId: string, accountId: string, positionAfterId: string | null): Promise<void> {
  const siblings = await prisma.incomeSource.findMany({ where: { accountId, id: { not: sourceId } }, orderBy: { sortOrder: 'asc' } });
  let insertIndex: number;
  if (positionAfterId === null) { insertIndex = 0; }
  else {
    const idx = siblings.findIndex((s) => s.id === positionAfterId);
    insertIndex = idx === -1 ? siblings.length : idx + 1;
  }
  const reordered = [...siblings.slice(0, insertIndex), { id: sourceId }, ...siblings.slice(insertIndex)];
  for (let i = 0; i < reordered.length; i++) {
    await prisma.incomeSource.update({ where: { id: reordered[i].id }, data: { sortOrder: i + 1 } });
  }
}

// POST /api/income
router.post('/', async (req: Request, res: Response) => {
  try {
    const { positionAfterId, ...rest } = req.body;
    const source = await prisma.incomeSource.create({ data: { ...rest, accountId: req.accountId, sortOrder: 9999 } });
    await reorderIncome(source.id, req.accountId, positionAfterId !== undefined ? positionAfterId : source.id);

    // Backfill IncomeEntry rows for all existing pay periods so the source
    // shows up in the grid immediately without requiring a period regeneration.
    if (source.type !== 'AD_HOC') {
      const { incomeFallsInPeriod } = await import('../services/projectionEngine');
      const account = await prisma.account.findUnique({ where: { id: req.accountId } });
      const periods = await prisma.payPeriod.findMany({
        where: { accountId: req.accountId },
        orderBy: { paydayDate: 'asc' },
      });

      let firstPeriodId: string | null = null;
      for (const period of periods) {
        // Monthly accounts: one entry per period (each period = one month)
        // Biweekly W2: one entry per period
        // Biweekly MONTHLY_RECURRING: only periods where dayOfMonth falls in range
        const shouldCreate =
          account?.periodType === 'monthly' ||
          source.type === 'W2' ||
          (source.type === 'MONTHLY_RECURRING' && source.dayOfMonth != null &&
            incomeFallsInPeriod(source.dayOfMonth, period.startDate, period.endDate));

        if (!shouldCreate) continue;

        await prisma.incomeEntry.upsert({
          where: { payPeriodId_incomeSourceId: { payPeriodId: period.id, incomeSourceId: source.id } },
          create: { accountId: req.accountId, payPeriodId: period.id, incomeSourceId: source.id, projectedAmount: source.defaultAmount },
          update: {},
        });
        if (!firstPeriodId) firstPeriodId = period.id;
      }

      if (firstPeriodId) {
        const affectedIds = await recomputeFromPeriod(firstPeriodId);
        broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
      }
    }

    const updated = await prisma.incomeSource.findUniqueOrThrow({ where: { id: source.id } });
    res.status(201).json(updated);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

async function resyncMonthlyEntries(sourceId: string, accountId: string, dayOfMonth: number, amount: number): Promise<string | null> {
  const { incomeFallsInPeriod } = await import('../services/projectionEngine');
  const today = new Date();
  const futurePeriods = await prisma.payPeriod.findMany({
    where: { accountId, paydayDate: { gte: today } },
    orderBy: { paydayDate: 'asc' },
  });
  if (futurePeriods.length === 0) return null;

  for (const period of futurePeriods) {
    const falls = incomeFallsInPeriod(dayOfMonth, period.startDate, period.endDate);
    const existing = await prisma.incomeEntry.findFirst({ where: { incomeSourceId: sourceId, payPeriodId: period.id } });

    if (!falls) {
      if (existing && !existing.isReconciled) await prisma.incomeEntry.delete({ where: { id: existing.id } });
    } else {
      if (!existing) {
        await prisma.incomeEntry.create({ data: { accountId, incomeSourceId: sourceId, payPeriodId: period.id, projectedAmount: amount } });
      } else if (!existing.isReconciled) {
        await prisma.incomeEntry.update({ where: { id: existing.id }, data: { projectedAmount: amount } });
      }
    }
  }
  return futurePeriods[0].id;
}

// PUT /api/income/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, type, defaultAmount, isActive, propagateOnReconcile, dayOfMonth, expectedDayOfMonth, endDate, notes, positionAfterId, cascadeDefault } = req.body;
    const source = await prisma.incomeSource.update({
      where: { id: req.params.id },
      data: { name, type, defaultAmount, isActive, propagateOnReconcile, dayOfMonth, expectedDayOfMonth, endDate, notes },
    });
    if ('positionAfterId' in req.body) await reorderIncome(req.params.id, req.accountId, positionAfterId);

    if (source.type === 'MONTHLY_RECURRING' && source.dayOfMonth !== null && cascadeDefault) {
      const firstId = await resyncMonthlyEntries(req.params.id, req.accountId, source.dayOfMonth, source.defaultAmount);
      if (firstId) {
        const affectedIds = await recomputeFromPeriod(firstId);
        broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
      }
    } else if (cascadeDefault && typeof defaultAmount === 'number') {
      const today = new Date();
      const firstFuturePeriod = await prisma.payPeriod.findFirst({ where: { accountId: req.accountId, paydayDate: { gte: today } }, orderBy: { paydayDate: 'asc' } });
      if (firstFuturePeriod) {
        await prisma.incomeEntry.updateMany({
          where: { accountId: req.accountId, incomeSourceId: req.params.id, isReconciled: false, payPeriod: { paydayDate: { gte: today } } },
          data: { projectedAmount: defaultAmount },
        });
        const affectedIds = await recomputeFromPeriod(firstFuturePeriod.id);
        broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
      }
    }

    const updated = await prisma.incomeSource.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(updated);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/income/:id/archive
router.patch('/:id/archive', async (req: Request, res: Response) => {
  try {
    const source = await prisma.incomeSource.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json(source);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/income/:id/restore
router.patch('/:id/restore', async (req: Request, res: Response) => {
  try {
    const source = await prisma.incomeSource.update({ where: { id: req.params.id }, data: { isActive: true } });
    res.json(source);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export default router;
