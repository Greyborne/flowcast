import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { recomputeFromPeriod } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';

const router = Router();

// GET /api/bills — list all bill templates
router.get('/', async (_req: Request, res: Response) => {
  try {
    const bills = await prisma.billTemplate.findMany({
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
      include: { monthlyAmounts: { orderBy: [{ year: 'asc' }, { month: 'asc' }] } },
    });
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bills' });
  }
});

// PATCH /api/bills/instance/:id — draft-save projected amount, optionally cascade to future instances
router.patch('/instance/:id', async (req: Request, res: Response) => {
  try {
    const { projectedAmount, cascade = true } = req.body;
    if (typeof projectedAmount !== 'number') {
      return res.status(400).json({ error: 'projectedAmount (number) is required' });
    }

    const inst = await prisma.billInstance.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { payPeriod: true },
    });

    if (inst.isFrozen) {
      return res.status(400).json({ error: 'Cannot update a frozen instance' });
    }

    await prisma.billInstance.update({
      where: { id: req.params.id },
      data: { projectedAmount },
    });

    if (cascade) {
      const future = await prisma.billInstance.findMany({
        where: {
          billTemplateId: inst.billTemplateId,
          isReconciled: false,
          payPeriod: { paydayDate: { gt: inst.payPeriod.paydayDate } },
        },
      });
      if (future.length > 0) {
        await prisma.billInstance.updateMany({
          where: { id: { in: future.map((i) => i.id) } },
          data: { projectedAmount },
        });
      }
    }

    const affectedIds = await recomputeFromPeriod(inst.payPeriodId);
    broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bills/grid — all active templates + instance map for grid rendering
router.get('/grid', async (_req: Request, res: Response) => {
  try {
    const [templates, instances] = await Promise.all([
      prisma.billTemplate.findMany({
        where: { isActive: true },
        orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
      }),
      prisma.billInstance.findMany({
        select: {
          id: true,
          payPeriodId: true,
          billTemplateId: true,
          projectedAmount: true,
          actualAmount: true,
          isReconciled: true,
          isFrozen: true,
        },
      }),
    ]);

    // Build { [billTemplateId]: { [payPeriodId]: instance } } for O(1) cell lookups
    const instanceMap: Record<string, Record<string, (typeof instances)[0]>> = {};
    for (const inst of instances) {
      if (!instanceMap[inst.billTemplateId]) instanceMap[inst.billTemplateId] = {};
      instanceMap[inst.billTemplateId][inst.payPeriodId] = inst;
    }

    res.json({ templates, instanceMap });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bill grid' });
  }
});

// GET /api/bills/:id — get one bill template
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const bill = await prisma.billTemplate.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { monthlyAmounts: true },
    });
    res.json(bill);
  } catch {
    res.status(404).json({ error: 'Bill not found' });
  }
});

// POST /api/bills — create a new bill template
router.post('/', async (req: Request, res: Response) => {
  try {
    const bill = await prisma.billTemplate.create({ data: req.body });
    res.status(201).json(bill);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/bills/:id — update a bill template
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const bill = await prisma.billTemplate.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(bill);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/bills/:id/monthly/:year/:month — set amount for a specific month
router.put('/:id/monthly/:year/:month', async (req: Request, res: Response) => {
  try {
    const { id, year, month } = req.params;
    const { amount } = req.body;
    const monthly = await prisma.billMonthlyAmount.upsert({
      where: {
        billTemplateId_year_month: {
          billTemplateId: id,
          year: Number(year),
          month: Number(month),
        },
      },
      create: { billTemplateId: id, year: Number(year), month: Number(month), amount },
      update: { amount },
    });
    res.json(monthly);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
