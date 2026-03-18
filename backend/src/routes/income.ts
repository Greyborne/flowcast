import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';

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
