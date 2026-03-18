import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';

const router = Router();

// GET /api/settings — get all app settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await prisma.appSetting.findMany();
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    res.json(map);
  } catch {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/settings/:key — set a single setting
router.put('/:key', async (req: Request, res: Response) => {
  try {
    const setting = await prisma.appSetting.upsert({
      where: { key: req.params.key },
      create: { key: req.params.key, value: String(req.body.value) },
      update: { value: String(req.body.value) },
    });
    res.json(setting);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
