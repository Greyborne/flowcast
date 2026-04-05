import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { recomputeFromPeriod } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';
import { acctKey } from '../middleware/accountContext';

const router = Router();

// GET /api/bills — list all bill templates for this account
router.get('/', async (req: Request, res: Response) => {
  try {
    const bills = await prisma.billTemplate.findMany({
      where: { accountId: req.accountId },
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
      include: { monthlyAmounts: { orderBy: [{ year: 'asc' }, { month: 'asc' }] } },
    });
    res.json(bills);
  } catch {
    res.status(500).json({ error: 'Failed to fetch bills' });
  }
});

// PATCH /api/bills/instance/:id — draft-save projected amount
router.patch('/instance/:id', async (req: Request, res: Response) => {
  try {
    const { projectedAmount, cascade = true } = req.body;
    if (typeof projectedAmount !== 'number') return res.status(400).json({ error: 'projectedAmount (number) is required' });

    const inst = await prisma.billInstance.findUniqueOrThrow({ where: { id: req.params.id }, include: { payPeriod: true } });
    if (inst.isFrozen) return res.status(400).json({ error: 'Cannot update a frozen instance' });

    await prisma.billInstance.update({ where: { id: req.params.id }, data: { projectedAmount } });

    if (cascade) {
      const future = await prisma.billInstance.findMany({
        where: { accountId: req.accountId, billTemplateId: inst.billTemplateId, isReconciled: false, payPeriod: { paydayDate: { gt: inst.payPeriod.paydayDate } } },
      });
      if (future.length > 0) {
        await prisma.billInstance.updateMany({ where: { id: { in: future.map((i) => i.id) } }, data: { projectedAmount } });
      }
    }

    const affectedIds = await recomputeFromPeriod(inst.payPeriodId);
    broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bills/grid — all active templates + instance map for this account
router.get('/grid', async (req: Request, res: Response) => {
  try {
    const [templates, instances, groups] = await Promise.all([
      prisma.billTemplate.findMany({
        where: { accountId: req.accountId, isActive: true },
        orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
      }),
      prisma.billInstance.findMany({
        where: { accountId: req.accountId },
        select: { id: true, payPeriodId: true, billTemplateId: true, projectedAmount: true, actualAmount: true, isReconciled: true, isFrozen: true, notes: true },
      }),
      getOrderedGroups(req.accountId),
    ]);

    const instanceMap: Record<string, Record<string, (typeof instances)[0]>> = {};
    for (const inst of instances) {
      if (!instanceMap[inst.billTemplateId]) instanceMap[inst.billTemplateId] = {};
      instanceMap[inst.billTemplateId][inst.payPeriodId] = inst;
    }

    res.json({ templates, instanceMap, groups });
  } catch {
    res.status(500).json({ error: 'Failed to fetch bill grid' });
  }
});

// ── Group Management ──────────────────────────────────────────────────────────

async function getOrderedGroups(accountId: string): Promise<string[]> {
  const setting = await prisma.appSetting.findUnique({ where: { key: acctKey(accountId, 'billGroups') } });
  if (setting) return JSON.parse(setting.value);
  const templates = await prisma.billTemplate.findMany({
    where: { accountId },
    distinct: ['group'],
    orderBy: { group: 'asc' },
    select: { group: true },
  });
  const groups = templates.map((t) => t.group);
  await prisma.appSetting.create({ data: { key: acctKey(accountId, 'billGroups'), value: JSON.stringify(groups) } });
  return groups;
}

async function saveOrderedGroups(accountId: string, groups: string[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: acctKey(accountId, 'billGroups') },
    create: { key: acctKey(accountId, 'billGroups'), value: JSON.stringify(groups) },
    update: { value: JSON.stringify(groups) },
  });
}

router.get('/groups', async (req: Request, res: Response) => {
  try { res.json(await getOrderedGroups(req.accountId)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/groups', async (req: Request, res: Response) => {
  try {
    const { name, positionAfterId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const groups = await getOrderedGroups(req.accountId);
    if (groups.includes(name)) return res.status(400).json({ error: 'Group already exists' });
    insertAt(groups, name, positionAfterId !== undefined ? positionAfterId : groups[groups.length - 1]);
    await saveOrderedGroups(req.accountId, groups);
    res.json(groups);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.patch('/groups/rename', async (req: Request, res: Response) => {
  try {
    const { oldName, newName, positionAfterId } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName are required' });
    let groups = await getOrderedGroups(req.accountId);
    if (!groups.includes(oldName)) return res.status(404).json({ error: 'Group not found' });
    if (newName !== oldName && groups.includes(newName)) return res.status(400).json({ error: 'Group name already exists' });

    await prisma.billTemplate.updateMany({ where: { accountId: req.accountId, group: oldName }, data: { group: newName } });

    groups = groups.filter((g) => g !== oldName);
    insertAt(groups, newName, positionAfterId !== undefined ? positionAfterId : groups[groups.length - 1]);
    await saveOrderedGroups(req.accountId, groups);
    res.json(groups);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete('/groups/:name', async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const activeCount = await prisma.billTemplate.count({ where: { accountId: req.accountId, group: name, isActive: true } });
    if (activeCount > 0) return res.status(400).json({ error: `Cannot delete: ${activeCount} active template(s) in this group` });
    let groups = await getOrderedGroups(req.accountId);
    groups = groups.filter((g) => g !== name);
    await saveOrderedGroups(req.accountId, groups);
    res.json(groups);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

function insertAt(arr: string[], name: string, positionAfterId: string | null): void {
  if (positionAfterId === null) { arr.unshift(name); }
  else {
    const idx = arr.indexOf(positionAfterId);
    arr.splice(idx === -1 ? arr.length : idx + 1, 0, name);
  }
}

// POST /api/bills/adhoc
router.post('/adhoc', async (req: Request, res: Response) => {
  try {
    const { billTemplateId, payPeriodId, projectedAmount } = req.body;
    if (!billTemplateId || !payPeriodId) return res.status(400).json({ error: 'billTemplateId and payPeriodId are required' });

    const existing = await prisma.billInstance.findFirst({ where: { billTemplateId, payPeriodId } });
    if (existing) return res.status(400).json({ error: 'An instance already exists for this bill in this period' });

    const template = await prisma.billTemplate.findUniqueOrThrow({ where: { id: billTemplateId } });
    const inst = await prisma.billInstance.create({
      data: { accountId: req.accountId, billTemplateId, payPeriodId, projectedAmount: projectedAmount ?? template.defaultAmount, isReconciled: false, isFrozen: false },
    });

    const affectedIds = await recomputeFromPeriod(payPeriodId);
    broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    res.status(201).json(inst);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// GET /api/bills/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const bill = await prisma.billTemplate.findUniqueOrThrow({ where: { id: req.params.id }, include: { monthlyAmounts: true } });
    res.json(bill);
  } catch { res.status(404).json({ error: 'Bill not found' }); }
});

// POST /api/bills
router.post('/', async (req: Request, res: Response) => {
  try {
    const { positionAfterId, ...rest } = req.body;
    const bill = await prisma.billTemplate.create({
      data: { ...rest, accountId: req.accountId, billType: rest.billType ?? 'EXPENSE', sortOrder: 9999 },
    });
    await reorderGroup(bill.id, bill.group, req.accountId, positionAfterId !== undefined ? positionAfterId : bill.id);
    const updated = await prisma.billTemplate.findUniqueOrThrow({ where: { id: bill.id } });
    res.status(201).json(updated);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// PUT /api/bills/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, group, billType, dueDayOfMonth, defaultAmount, isActive, isDiscretionary, notes, positionAfterId } = req.body;
    const existing = await prisma.billTemplate.findUniqueOrThrow({ where: { id: req.params.id } });
    const bill = await prisma.billTemplate.update({
      where: { id: req.params.id },
      data: { name, group, billType, dueDayOfMonth, defaultAmount, isActive, isDiscretionary, notes },
    });

    if (typeof defaultAmount === 'number' && defaultAmount !== existing.defaultAmount) {
      await prisma.billInstance.updateMany({ where: { accountId: req.accountId, billTemplateId: req.params.id, isReconciled: false }, data: { projectedAmount: defaultAmount } });
      const earliest = await prisma.billInstance.findFirst({
        where: { accountId: req.accountId, billTemplateId: req.params.id, isReconciled: false },
        orderBy: { payPeriod: { paydayDate: 'asc' } },
        select: { payPeriodId: true },
      });
      if (earliest) {
        const affectedIds = await recomputeFromPeriod(earliest.payPeriodId);
        broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
      }
    }

    if ('positionAfterId' in req.body) {
      await reorderGroup(req.params.id, bill.group, req.accountId, positionAfterId);
    }
    const updated = await prisma.billTemplate.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(updated);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

async function reorderGroup(billId: string, group: string, accountId: string, positionAfterId: string | null): Promise<void> {
  const siblings = await prisma.billTemplate.findMany({
    where: { accountId, group, id: { not: billId } },
    orderBy: { sortOrder: 'asc' },
  });

  let insertIndex: number;
  if (positionAfterId === null) { insertIndex = 0; }
  else {
    const idx = siblings.findIndex((b) => b.id === positionAfterId);
    insertIndex = idx === -1 ? siblings.length : idx + 1;
  }

  const reordered = [...siblings.slice(0, insertIndex), { id: billId }, ...siblings.slice(insertIndex)];
  for (let i = 0; i < reordered.length; i++) {
    await prisma.billTemplate.update({ where: { id: reordered[i].id }, data: { sortOrder: i + 1 } });
  }
}

// PATCH /api/bills/:id/archive
router.patch('/:id/archive', async (req: Request, res: Response) => {
  try {
    const bill = await prisma.billTemplate.update({ where: { id: req.params.id }, data: { isActive: false } });
    const earliest = await prisma.billInstance.findFirst({ where: { accountId: req.accountId, billTemplateId: bill.id }, orderBy: { payPeriod: { paydayDate: 'asc' } } });
    if (earliest) {
      const affectedIds = await recomputeFromPeriod(earliest.payPeriodId);
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    }
    res.json(bill);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/bills/:id/restore
router.patch('/:id/restore', async (req: Request, res: Response) => {
  try {
    const bill = await prisma.billTemplate.update({ where: { id: req.params.id }, data: { isActive: true } });
    const earliest = await prisma.billInstance.findFirst({ where: { accountId: req.accountId, billTemplateId: bill.id }, orderBy: { payPeriod: { paydayDate: 'asc' } } });
    if (earliest) {
      const affectedIds = await recomputeFromPeriod(earliest.payPeriodId);
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    }
    res.json(bill);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/bills/:id/monthly/:year/:month
router.delete('/:id/monthly/:year/:month', async (req: Request, res: Response) => {
  try {
    const { id, year, month } = req.params;
    await prisma.billMonthlyAmount.delete({ where: { billTemplateId_year_month: { billTemplateId: id, year: Number(year), month: Number(month) } } });
    res.json({ success: true });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// PUT /api/bills/:id/monthly/:year/:month
router.put('/:id/monthly/:year/:month', async (req: Request, res: Response) => {
  try {
    const { id, year, month } = req.params;
    const { amount } = req.body;
    const monthly = await prisma.billMonthlyAmount.upsert({
      where: { billTemplateId_year_month: { billTemplateId: id, year: Number(year), month: Number(month) } },
      create: { accountId: req.accountId, billTemplateId: id, year: Number(year), month: Number(month), amount },
      update: { amount },
    });
    res.json(monthly);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export default router;
