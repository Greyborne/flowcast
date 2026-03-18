import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { computePeriodProjection } from '../services/projectionEngine';

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

export default router;
