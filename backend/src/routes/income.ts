import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { recomputeFromPeriod } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';

const router = Router();

// GET /api/income — list all income sources
router.get('/', async (_req: Request, res: Response) => {
  try {
    const sources = await prisma.incomeSource.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json(sources);
  } catch {
    res.status(500).json({ error: 'Failed to fetch income sources' });
  }
});

// GET /api/income/grid — all active sources + entry map for grid rendering
router.get('/grid', async (_req: Request, res: Response) => {
  try {
    const [sources, entries] = await Promise.all([
      prisma.incomeSource.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.incomeEntry.findMany({
        select: {
          id: true,
          payPeriodId: true,
          incomeSourceId: true,
          projectedAmount: true,
          actualAmount: true,
          isReconciled: true,
          notes: true,
        },
      }),
    ]);

    // Build { [incomeSourceId]: { [payPeriodId]: entry } } for O(1) cell lookups
    const entryMap: Record<string, Record<string, (typeof entries)[0]>> = {};
    for (const entry of entries) {
      if (!entryMap[entry.incomeSourceId]) entryMap[entry.incomeSourceId] = {};
      entryMap[entry.incomeSourceId][entry.payPeriodId] = entry;
    }

    res.json({ sources, entryMap });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch income grid' });
  }
});

// PATCH /api/income/entry/:id — draft-save projected amount, optionally cascade to future entries
router.patch('/entry/:id', async (req: Request, res: Response) => {
  try {
    const { projectedAmount, cascade = true } = req.body;
    if (typeof projectedAmount !== 'number') {
      return res.status(400).json({ error: 'projectedAmount (number) is required' });
    }

    const entry = await prisma.incomeEntry.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { payPeriod: true },
    });

    if (entry.isReconciled) {
      return res.status(400).json({ error: 'Cannot update a reconciled entry' });
    }

    await prisma.incomeEntry.update({
      where: { id: req.params.id },
      data: { projectedAmount },
    });

    if (cascade) {
      const future = await prisma.incomeEntry.findMany({
        where: {
          incomeSourceId: entry.incomeSourceId,
          isReconciled: false,
          payPeriod: { paydayDate: { gt: entry.payPeriod.paydayDate } },
        },
      });
      if (future.length > 0) {
        await prisma.incomeEntry.updateMany({
          where: { id: { in: future.map((e) => e.id) } },
          data: { projectedAmount },
        });
      }
      await prisma.incomeSource.update({
        where: { id: entry.incomeSourceId },
        data: { defaultAmount: projectedAmount },
      });
    }

    const affectedIds = await recomputeFromPeriod(entry.payPeriodId);
    broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Reorder all income sources so they have clean 1-based sortOrders.
 * sourceId is inserted after positionAfterId (null = first).
 */
async function reorderIncome(sourceId: string, positionAfterId: string | null): Promise<void> {
  const siblings = await prisma.incomeSource.findMany({
    where: { id: { not: sourceId } },
    orderBy: { sortOrder: 'asc' },
  });

  let insertIndex: number;
  if (positionAfterId === null) {
    insertIndex = 0;
  } else {
    const idx = siblings.findIndex((s) => s.id === positionAfterId);
    insertIndex = idx === -1 ? siblings.length : idx + 1;
  }

  const reordered = [
    ...siblings.slice(0, insertIndex),
    { id: sourceId },
    ...siblings.slice(insertIndex),
  ];

  for (let i = 0; i < reordered.length; i++) {
    await prisma.incomeSource.update({
      where: { id: reordered[i].id },
      data: { sortOrder: i + 1 },
    });
  }
}

// POST /api/income — create an income source
router.post('/', async (req: Request, res: Response) => {
  try {
    const { positionAfterId, ...rest } = req.body;
    const source = await prisma.incomeSource.create({ data: { ...rest, sortOrder: 9999 } });
    await reorderIncome(source.id, positionAfterId !== undefined ? positionAfterId : source.id);
    const updated = await prisma.incomeSource.findUniqueOrThrow({ where: { id: source.id } });
    res.status(201).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Resync future unreconciled entries for a MONTHLY_RECURRING source:
 * - Deletes unreconciled entries in periods where dayOfMonth doesn't fall
 * - Upserts entries with the correct amount in periods where it does
 * Returns the earliest affected payPeriodId for recomputation, or null if none.
 */
async function resyncMonthlyEntries(sourceId: string, dayOfMonth: number, amount: number): Promise<string | null> {
  const { incomeFallsInPeriod } = await import('../services/projectionEngine');
  const today = new Date();

  const futurePeriods = await prisma.payPeriod.findMany({
    where: { paydayDate: { gte: today } },
    orderBy: { paydayDate: 'asc' },
  });
  if (futurePeriods.length === 0) return null;

  for (const period of futurePeriods) {
    const falls = incomeFallsInPeriod(dayOfMonth, period.startDate, period.endDate);
    const existing = await prisma.incomeEntry.findFirst({
      where: { incomeSourceId: sourceId, payPeriodId: period.id },
    });

    if (!falls) {
      // Remove unreconciled entry that doesn't belong in this period
      if (existing && !existing.isReconciled) {
        await prisma.incomeEntry.delete({ where: { id: existing.id } });
      }
    } else {
      // Upsert entry with correct amount
      if (!existing) {
        await prisma.incomeEntry.create({
          data: { incomeSourceId: sourceId, payPeriodId: period.id, projectedAmount: amount },
        });
      } else if (!existing.isReconciled) {
        await prisma.incomeEntry.update({
          where: { id: existing.id },
          data: { projectedAmount: amount },
        });
      }
    }
  }

  return futurePeriods[0].id;
}

// PUT /api/income/:id — update an income source
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, type, defaultAmount, isActive, propagateOnReconcile, dayOfMonth, endDate, notes, positionAfterId, cascadeDefault } = req.body;
    const source = await prisma.incomeSource.update({
      where: { id: req.params.id },
      data: { name, type, defaultAmount, isActive, propagateOnReconcile, dayOfMonth, endDate, notes },
    });
    if ('positionAfterId' in req.body) {
      await reorderIncome(req.params.id, positionAfterId);
    }

    // For MONTHLY_RECURRING with a dayOfMonth: always resync future entries
    // (deletes entries in wrong periods, upserts entries in correct periods).
    // For other types: simple amount cascade when cascadeDefault is set.
    if (source.type === 'MONTHLY_RECURRING' && source.dayOfMonth !== null && cascadeDefault) {
      const firstId = await resyncMonthlyEntries(req.params.id, source.dayOfMonth, source.defaultAmount);
      if (firstId) {
        const affectedIds = await recomputeFromPeriod(firstId);
        broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
      }
    } else if (cascadeDefault && typeof defaultAmount === 'number') {
      const today = new Date();
      const firstFuturePeriod = await prisma.payPeriod.findFirst({
        where: { paydayDate: { gte: today } },
        orderBy: { paydayDate: 'asc' },
      });
      if (firstFuturePeriod) {
        await prisma.incomeEntry.updateMany({
          where: {
            incomeSourceId: req.params.id,
            isReconciled: false,
            payPeriod: { paydayDate: { gte: today } },
          },
          data: { projectedAmount: defaultAmount },
        });
        const affectedIds = await recomputeFromPeriod(firstFuturePeriod.id);
        broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
      }
    }

    const updated = await prisma.incomeSource.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/income/:id/archive — soft-delete
router.patch('/:id/archive', async (req: Request, res: Response) => {
  try {
    const source = await prisma.incomeSource.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json(source);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/income/:id/restore — restore archived source
router.patch('/:id/restore', async (req: Request, res: Response) => {
  try {
    const source = await prisma.incomeSource.update({
      where: { id: req.params.id },
      data: { isActive: true },
    });
    res.json(source);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
