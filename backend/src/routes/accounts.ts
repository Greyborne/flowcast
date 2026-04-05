/**
 * Accounts Route
 *
 * CRUD for Account records. Creating an account also seeds its AppSettings
 * so the onboarding wizard (5b) can write settings before any periods exist.
 *
 * The default "Personal" account (id="personal") is created by the migration
 * and cannot be deleted.
 */

import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { addToAccountCache, removeFromAccountCache, acctKey } from '../middleware/accountContext';

const router = Router();

const VALID_COLORS = ['blue', 'green', 'purple', 'amber', 'rose', 'teal'] as const;
const VALID_PERIOD_TYPES = ['biweekly', 'monthly'] as const;

// GET /api/accounts — list all accounts
router.get('/', async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.account.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(accounts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/:id — get one account
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(account);
  } catch {
    res.status(404).json({ error: 'Account not found' });
  }
});

// POST /api/accounts — create a new account
// Body: { name, color?, periodType? }
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, color = 'blue', periodType = 'biweekly' } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (!VALID_COLORS.includes(color)) {
      return res.status(400).json({ error: `color must be one of: ${VALID_COLORS.join(', ')}` });
    }
    if (!VALID_PERIOD_TYPES.includes(periodType)) {
      return res.status(400).json({ error: `periodType must be one of: ${VALID_PERIOD_TYPES.join(', ')}` });
    }

    const account = await prisma.account.create({ data: { name: name.trim(), color, periodType } });
    addToAccountCache(account.id);

    // Seed default AppSettings for the new account so the onboarding wizard has a clean slate
    await prisma.appSetting.createMany({
      data: [
        { key: acctKey(account.id, 'payFrequency'), value: periodType },
        { key: acctKey(account.id, 'projectionYears'), value: '2' },
        { key: acctKey(account.id, 'currentBankBalance'), value: '0' },
      ],
    });

    res.status(201).json(account);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/accounts/:id — update name, color, or periodType
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, color, periodType } = req.body;

    if (color && !VALID_COLORS.includes(color)) {
      return res.status(400).json({ error: `color must be one of: ${VALID_COLORS.join(', ')}` });
    }
    if (periodType && !VALID_PERIOD_TYPES.includes(periodType)) {
      return res.status(400).json({ error: `periodType must be one of: ${VALID_PERIOD_TYPES.join(', ')}` });
    }

    const account = await prisma.account.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(color !== undefined && { color }),
        ...(periodType !== undefined && { periodType }),
      },
    });
    res.json(account);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/accounts/:id — delete account only if it has no data
// The "personal" account cannot be deleted.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (id === 'personal') {
      return res.status(400).json({ error: 'The Personal account cannot be deleted' });
    }

    // Check for any data belonging to this account
    const [periods, templates, sources] = await Promise.all([
      prisma.payPeriod.count({ where: { accountId: id } }),
      prisma.billTemplate.count({ where: { accountId: id } }),
      prisma.incomeSource.count({ where: { accountId: id } }),
    ]);

    if (periods + templates + sources > 0) {
      return res.status(400).json({
        error: `Cannot delete account with existing data (${periods} periods, ${templates} templates, ${sources} income sources). Clear account data first.`,
      });
    }

    await prisma.account.delete({ where: { id } });
    removeFromAccountCache(id);

    // Clean up account-prefixed AppSettings
    await prisma.appSetting.deleteMany({ where: { key: { startsWith: `${id}:` } } });

    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
