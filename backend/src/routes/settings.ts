import { Router, Request, Response } from 'express';
import { addWeeks, addDays, addMonths, startOfDay, setDate } from 'date-fns';
import prisma from '../models/prisma';
import { recomputeFromPeriod } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';

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

// PUT /api/settings — save multiple settings at once
router.put('/', async (req: Request, res: Response) => {
  try {
    const entries: Record<string, string> = req.body;
    for (const [key, value] of Object.entries(entries)) {
      await prisma.appSetting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/settings/regenerate-periods — rebuild pay periods from anchor + frequency
router.post('/regenerate-periods', async (_req: Request, res: Response) => {
  try {
    const settingsRows = await prisma.appSetting.findMany();
    const s = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));

    const anchorDate   = s['payScheduleAnchor'];
    const frequency    = s['payFrequency'] ?? 'biweekly';
    const years        = parseInt(s['projectionYears'] ?? '2', 10);
    const openingBal   = parseFloat(s['currentBankBalance'] ?? '0');

    if (!anchorDate) {
      return res.status(400).json({ error: 'payScheduleAnchor is not set in settings' });
    }

    const anchor = startOfDay(new Date(anchorDate + 'T12:00:00'));
    const totalPeriods = computePeriodCount(frequency, years);

    // Build the target schedule of payday dates
    const schedule = buildSchedule(anchor, frequency, totalPeriods);

    // Find periods that have ANY reconciled data — never delete these
    const reconciledPeriodIds = new Set<string>();
    const reconciledBills = await prisma.billInstance.findMany({
      where: { isReconciled: true },
      select: { payPeriodId: true },
    });
    const reconciledIncome = await prisma.incomeEntry.findMany({
      where: { isReconciled: true },
      select: { payPeriodId: true },
    });
    reconciledBills.forEach((b) => reconciledPeriodIds.add(b.payPeriodId));
    reconciledIncome.forEach((e) => reconciledPeriodIds.add(e.payPeriodId));

    // Delete existing unreconciled periods not on the new schedule
    const existingPeriods = await prisma.payPeriod.findMany({
      orderBy: { paydayDate: 'asc' },
    });
    const scheduleSet = new Set(schedule.map((d) => d.toISOString()));
    const toDelete = existingPeriods.filter(
      (p) => !reconciledPeriodIds.has(p.id) && !scheduleSet.has(startOfDay(p.paydayDate).toISOString())
    );
    if (toDelete.length > 0) {
      await prisma.payPeriod.deleteMany({ where: { id: { in: toDelete.map((p) => p.id) } } });
    }

    // Find which schedule dates don't yet have a period
    const existingDates = new Set(
      existingPeriods
        .filter((p) => !toDelete.find((d) => d.id === p.id))
        .map((p) => startOfDay(p.paydayDate).toISOString())
    );
    const toCreate = schedule.filter((d) => !existingDates.has(d.toISOString()));

    // Create missing periods
    const periodLength = getPeriodLengthDays(frequency);
    if (toCreate.length > 0) {
      await prisma.payPeriod.createMany({
        data: toCreate.map((paydayDate) => ({
          paydayDate,
          startDate: paydayDate,
          endDate: addDays(paydayDate, periodLength - 1),
          openingBalance: 0,
        })),
      });
    }

    // Set opening balance on the earliest unreconciled period
    const firstUnreconciled = await prisma.payPeriod.findFirst({
      where: { id: { notIn: [...reconciledPeriodIds] } },
      orderBy: { paydayDate: 'asc' },
    });
    if (firstUnreconciled) {
      await prisma.payPeriod.update({
        where: { id: firstUnreconciled.id },
        data: { openingBalance: openingBal },
      });
      // Populate bill instances and income entries for new periods
      await populateNewPeriods(toCreate, periodLength);

      const affectedIds = await recomputeFromPeriod(firstUnreconciled.id);
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    }

    res.json({
      success: true,
      created: toCreate.length,
      deleted: toDelete.length,
      message: `Pay periods regenerated: ${toCreate.length} created, ${toDelete.length} removed`,
    });
  } catch (err: any) {
    console.error('[regenerate-periods]', err);
    res.status(500).json({ error: err.message || 'Failed to regenerate periods' });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function computePeriodCount(frequency: string, years: number): number {
  switch (frequency) {
    case 'weekly':      return Math.ceil((years * 365) / 7);
    case 'biweekly':   return Math.ceil((years * 365) / 14);
    case 'monthly':    return years * 12;
    default:           return Math.ceil((years * 365) / 14);
  }
}

function buildSchedule(anchor: Date, frequency: string, count: number): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    let d: Date;
    switch (frequency) {
      case 'weekly':
        d = addWeeks(anchor, i);
        break;
      case 'biweekly':
        d = addWeeks(anchor, i * 2);
        break;
      case 'monthly':
        d = addMonths(anchor, i);
        d = setDate(d, anchor.getDate());
        break;
      default:
        d = addWeeks(anchor, i * 2);
    }
    dates.push(startOfDay(d));
  }
  return dates;
}

function getPeriodLengthDays(frequency: string): number {
  switch (frequency) {
    case 'weekly':    return 7;
    case 'biweekly':  return 14;
    case 'monthly':   return 30; // approximate; projection engine handles the real dates
    default:          return 14;
  }
}

/**
 * For newly created pay periods, generate bill instances and income entries
 * using the same logic as the original seed / projection engine.
 */
async function populateNewPeriods(newPaydays: Date[], periodLength: number): Promise<void> {
  if (newPaydays.length === 0) return;

  const [activeBills, activeSources] = await Promise.all([
    prisma.billTemplate.findMany({ where: { isActive: true } }),
    prisma.incomeSource.findMany({ where: { isActive: true } }),
  ]);

  // Dynamically import helpers to avoid circular deps
  const { billFallsInPeriod, getBillAmountForMonth, incomeFallsInPeriod } = await import('../services/projectionEngine');

  for (const payday of newPaydays) {
    const period = await prisma.payPeriod.findFirst({
      where: { paydayDate: payday },
    });
    if (!period) continue;

    const periodStart = period.startDate;
    const periodEnd   = period.endDate;
    const year  = payday.getFullYear();
    const month = payday.getMonth() + 1;

    // Create bill instances for bills that fall in this period
    for (const bill of activeBills) {
      if (bill.dueDayOfMonth === null) continue; // discretionary — no fixed due date
      if (!billFallsInPeriod(bill.dueDayOfMonth, periodStart, periodEnd)) continue;

      const amount = await getBillAmountForMonth(bill.id, year, month);
      await prisma.billInstance.upsert({
        where: { payPeriodId_billTemplateId: { payPeriodId: period.id, billTemplateId: bill.id } },
        create: { payPeriodId: period.id, billTemplateId: bill.id, projectedAmount: amount },
        update: {},
      });
    }

    // Create income entries — MONTHLY_RECURRING sources only land in the period
    // where their dayOfMonth falls (mirrors bill due-day logic).
    // W2 and AD_HOC sources appear in every period.
    for (const source of activeSources) {
      if (source.type === 'MONTHLY_RECURRING' && source.dayOfMonth !== null) {
        if (!incomeFallsInPeriod(source.dayOfMonth, periodStart, periodEnd)) continue;
      }
      await prisma.incomeEntry.upsert({
        where: { payPeriodId_incomeSourceId: { payPeriodId: period.id, incomeSourceId: source.id } },
        create: { payPeriodId: period.id, incomeSourceId: source.id, projectedAmount: source.defaultAmount },
        update: {},
      });
    }
  }
}

export default router;
