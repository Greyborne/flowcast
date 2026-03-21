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
    const [templates, instances, groups] = await Promise.all([
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
          notes: true,
        },
      }),
      getOrderedGroups(),
    ]);

    // Build { [billTemplateId]: { [payPeriodId]: instance } } for O(1) cell lookups
    const instanceMap: Record<string, Record<string, (typeof instances)[0]>> = {};
    for (const inst of instances) {
      if (!instanceMap[inst.billTemplateId]) instanceMap[inst.billTemplateId] = {};
      instanceMap[inst.billTemplateId][inst.payPeriodId] = inst;
    }

    res.json({ templates, instanceMap, groups });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bill grid' });
  }
});

// ── Group Management ──────────────────────────────────────────────────────────

async function getOrderedGroups(): Promise<string[]> {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'billGroups' } });
  if (setting) return JSON.parse(setting.value);
  // Bootstrap from existing template data if setting doesn't exist yet
  const templates = await prisma.billTemplate.findMany({
    distinct: ['group'],
    orderBy: { group: 'asc' },
    select: { group: true },
  });
  const groups = templates.map((t) => t.group);
  await prisma.appSetting.create({ data: { key: 'billGroups', value: JSON.stringify(groups) } });
  return groups;
}

async function saveOrderedGroups(groups: string[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: 'billGroups' },
    create: { key: 'billGroups', value: JSON.stringify(groups) },
    update: { value: JSON.stringify(groups) },
  });
}

// GET /api/bills/groups — ordered group list
router.get('/groups', async (_req: Request, res: Response) => {
  try {
    res.json(await getOrderedGroups());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bills/groups — add a new group
router.post('/groups', async (req: Request, res: Response) => {
  try {
    const { name, positionAfterId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const groups = await getOrderedGroups();
    if (groups.includes(name)) return res.status(400).json({ error: 'Group already exists' });
    insertAt(groups, name, positionAfterId !== undefined ? positionAfterId : groups[groups.length - 1]);
    await saveOrderedGroups(groups);
    res.json(groups);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/bills/groups/rename — rename a group (+ optional reposition)
router.patch('/groups/rename', async (req: Request, res: Response) => {
  try {
    const { oldName, newName, positionAfterId } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName are required' });
    let groups = await getOrderedGroups();
    if (!groups.includes(oldName)) return res.status(404).json({ error: 'Group not found' });
    if (newName !== oldName && groups.includes(newName)) return res.status(400).json({ error: 'Group name already exists' });

    // Update all templates in the group
    await prisma.billTemplate.updateMany({ where: { group: oldName }, data: { group: newName } });

    // Reposition in the list
    groups = groups.filter((g) => g !== oldName);
    insertAt(groups, newName, positionAfterId !== undefined ? positionAfterId : groups[groups.length - 1]);
    await saveOrderedGroups(groups);
    res.json(groups);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/bills/groups/:name — delete group (must be empty)
router.delete('/groups/:name', async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const activeCount = await prisma.billTemplate.count({ where: { group: name, isActive: true } });
    if (activeCount > 0) {
      return res.status(400).json({ error: `Cannot delete: ${activeCount} active template(s) in this group` });
    }
    let groups = await getOrderedGroups();
    groups = groups.filter((g) => g !== name);
    await saveOrderedGroups(groups);
    res.json(groups);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** Insert `name` after `positionAfterId` in the array (null = first). Mutates in place. */
function insertAt(arr: string[], name: string, positionAfterId: string | null): void {
  if (positionAfterId === null) {
    arr.unshift(name);
  } else {
    const idx = arr.indexOf(positionAfterId);
    arr.splice(idx === -1 ? arr.length : idx + 1, 0, name);
  }
}

// POST /api/bills/adhoc — create an ad-hoc bill instance for any template+period combo
router.post('/adhoc', async (req: Request, res: Response) => {
  try {
    const { billTemplateId, payPeriodId, projectedAmount } = req.body;
    if (!billTemplateId || !payPeriodId) {
      return res.status(400).json({ error: 'billTemplateId and payPeriodId are required' });
    }

    const existing = await prisma.billInstance.findFirst({ where: { billTemplateId, payPeriodId } });
    if (existing) {
      return res.status(400).json({ error: 'An instance already exists for this bill in this period' });
    }

    const template = await prisma.billTemplate.findUniqueOrThrow({ where: { id: billTemplateId } });
    const inst = await prisma.billInstance.create({
      data: {
        billTemplateId,
        payPeriodId,
        projectedAmount: projectedAmount ?? template.defaultAmount,
        isReconciled: false,
        isFrozen: false,
      },
    });

    const affectedIds = await recomputeFromPeriod(payPeriodId);
    broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    res.status(201).json(inst);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
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
    const { positionAfterId, ...rest } = req.body;
    const bill = await prisma.billTemplate.create({
      data: { ...rest, billType: rest.billType ?? 'EXPENSE', sortOrder: 9999 },
    });
    // Reorder the group so the new bill lands at the right spot
    await reorderGroup(bill.id, bill.group, positionAfterId !== undefined ? positionAfterId : bill.id);
    const updated = await prisma.billTemplate.findUniqueOrThrow({ where: { id: bill.id } });
    res.status(201).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/bills/:id — update a bill template
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, group, billType, dueDayOfMonth, defaultAmount, isActive, isDiscretionary, notes, positionAfterId } = req.body;
    const existing = await prisma.billTemplate.findUniqueOrThrow({ where: { id: req.params.id } });
    const bill = await prisma.billTemplate.update({
      where: { id: req.params.id },
      data: { name, group, billType, dueDayOfMonth, defaultAmount, isActive, isDiscretionary, notes },
    });

    // If defaultAmount changed, cascade to all future unreconciled instances
    if (typeof defaultAmount === 'number' && defaultAmount !== existing.defaultAmount) {
      await prisma.billInstance.updateMany({
        where: { billTemplateId: req.params.id, isReconciled: false },
        data: { projectedAmount: defaultAmount },
      });
      // Recompute balances from the earliest affected period
      const earliest = await prisma.billInstance.findFirst({
        where: { billTemplateId: req.params.id, isReconciled: false },
        orderBy: { payPeriod: { paydayDate: 'asc' } },
        select: { payPeriodId: true },
      });
      if (earliest) {
        const affectedIds = await recomputeFromPeriod(earliest.payPeriodId);
        broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
      }
    }

    // Reorder if a position was explicitly chosen
    if ('positionAfterId' in req.body) {
      await reorderGroup(req.params.id, bill.group, positionAfterId);
    }
    const updated = await prisma.billTemplate.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Reorder all bills in a group so they have clean 1-based sortOrders.
 * billId is inserted after positionAfterId (null = first in group).
 */
async function reorderGroup(billId: string, group: string, positionAfterId: string | null): Promise<void> {
  const siblings = await prisma.billTemplate.findMany({
    where: { group, id: { not: billId } },
    orderBy: { sortOrder: 'asc' },
  });

  let insertIndex: number;
  if (positionAfterId === null) {
    insertIndex = 0;
  } else {
    const idx = siblings.findIndex((b) => b.id === positionAfterId);
    insertIndex = idx === -1 ? siblings.length : idx + 1;
  }

  const reordered = [
    ...siblings.slice(0, insertIndex),
    { id: billId },
    ...siblings.slice(insertIndex),
  ];

  for (let i = 0; i < reordered.length; i++) {
    await prisma.billTemplate.update({
      where: { id: reordered[i].id },
      data: { sortOrder: i + 1 },
    });
  }
}

// PATCH /api/bills/:id/archive — soft-delete (isActive: false)
router.patch('/:id/archive', async (req: Request, res: Response) => {
  try {
    const bill = await prisma.billTemplate.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json(bill);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/bills/:id/restore — restore archived template
router.patch('/:id/restore', async (req: Request, res: Response) => {
  try {
    const bill = await prisma.billTemplate.update({
      where: { id: req.params.id },
      data: { isActive: true },
    });
    res.json(bill);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/bills/:id/monthly/:year/:month — remove a monthly override
router.delete('/:id/monthly/:year/:month', async (req: Request, res: Response) => {
  try {
    const { id, year, month } = req.params;
    await prisma.billMonthlyAmount.delete({
      where: {
        billTemplateId_year_month: {
          billTemplateId: id,
          year: Number(year),
          month: Number(month),
        },
      },
    });
    res.json({ success: true });
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
