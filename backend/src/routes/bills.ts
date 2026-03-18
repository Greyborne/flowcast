import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';

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
