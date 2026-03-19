import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { recomputeFromPeriod } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';

const router = Router();

// GET /api/income — list all income sources
router.get('/', async (_req: Request, res: Response) => {
  try {
    const sources = await prisma.incomeSource.findMany({ orderBy: { name: 'asc' } });
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
        orderBy: { name: 'asc' },
      }),
      prisma.incomeEntry.findMany({
        select: {
          id: true,
          payPeriodId: true,
          incomeSourceId: true,
          projectedAmount: true,
          actualAmount: true,
          isReconciled: true,
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

// POST /api/income — create an income source
router.post('/', async (req: Request, res: Response) => {
  try {
    const source = await prisma.incomeSource.create({ data: req.body });
    res.status(201).json(source);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/income/:id — update an income source
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const source = await prisma.incomeSource.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(source);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
