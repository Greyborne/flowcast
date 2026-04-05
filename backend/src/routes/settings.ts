import { Router, Request, Response } from 'express';
import { addWeeks, addDays, addMonths, startOfDay, setDate } from 'date-fns';
import prisma from '../models/prisma';
import { recomputeFromPeriod, buildMonthlyPeriods } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';
import { acctKey } from '../middleware/accountContext';

const router = Router();

// GET /api/settings — get all app settings for this account
router.get('/', async (req: Request, res: Response) => {
  try {
    const prefix = `${req.accountId}:`;
    const settings = await prisma.appSetting.findMany({ where: { key: { startsWith: prefix } } });
    // Strip the accountId prefix so the frontend sees plain keys like "billGroups"
    const map = Object.fromEntries(settings.map((s) => [s.key.slice(prefix.length), s.value]));
    res.json(map);
  } catch {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/settings/:key — set a single setting (scoped to this account)
router.put('/:key', async (req: Request, res: Response) => {
  try {
    const key = acctKey(req.accountId, req.params.key);
    const setting = await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: String(req.body.value) },
      update: { value: String(req.body.value) },
    });
    // Return using the plain key so the frontend stays consistent
    res.json({ key: req.params.key, value: setting.value, updatedAt: setting.updatedAt });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/settings — save multiple settings at once (scoped to this account)
router.put('/', async (req: Request, res: Response) => {
  try {
    const entries: Record<string, string> = req.body;
    for (const [plainKey, value] of Object.entries(entries)) {
      const key = acctKey(req.accountId, plainKey);
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

// POST /api/settings/regenerate-periods — rebuild pay periods for this account
router.post('/regenerate-periods', async (req: Request, res: Response) => {
  try {
    const accountId = req.accountId;

    // Load account to determine period type
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const isMonthly = account.periodType === 'monthly';

    // Load settings (using account-prefixed keys)
    const settingsRows = await prisma.appSetting.findMany({ where: { key: { startsWith: `${accountId}:` } } });
    const prefix = `${accountId}:`;
    const s = Object.fromEntries(settingsRows.map((r) => [r.key.slice(prefix.length), r.value]));

    const anchorDate  = s['payScheduleAnchor'];
    const frequency   = isMonthly ? 'monthly' : (s['payFrequency'] ?? 'biweekly');
    const years       = parseInt(s['projectionYears'] ?? '2', 10);
    const openingBal  = parseFloat(s['currentBankBalance'] ?? '0');

    if (!anchorDate) {
      return res.status(400).json({ error: 'payScheduleAnchor is not set in settings' });
    }

    const anchor = startOfDay(new Date(anchorDate + 'T12:00:00'));
    const totalPeriods = computePeriodCount(frequency, years);

    // Build schedule — monthly accounts get proper 1st-to-last-day periods
    let schedule: Date[];
    let periods: Array<{ startDate: Date; endDate: Date; paydayDate: Date }> = [];

    if (isMonthly) {
      const anchorYear  = anchor.getFullYear();
      const anchorMonth = anchor.getMonth() + 1;
      periods = buildMonthlyPeriods(anchorYear, anchorMonth, totalPeriods);
      schedule = periods.map((p) => p.paydayDate);
    } else {
      schedule = buildBiweeklySchedule(anchor, frequency, totalPeriods);
    }

    // Find periods that have ANY reconciled data — never delete these
    const reconciledPeriodIds = new Set<string>();
    const [reconciledBills, reconciledIncome] = await Promise.all([
      prisma.billInstance.findMany({ where: { accountId, isReconciled: true }, select: { payPeriodId: true } }),
      prisma.incomeEntry.findMany({ where: { accountId, isReconciled: true }, select: { payPeriodId: true } }),
    ]);
    reconciledBills.forEach((b) => reconciledPeriodIds.add(b.payPeriodId));
    reconciledIncome.forEach((e) => reconciledPeriodIds.add(e.payPeriodId));

    // Delete existing unreconciled periods not on the new schedule
    const existingPeriods = await prisma.payPeriod.findMany({ where: { accountId }, orderBy: { paydayDate: 'asc' } });
    const scheduleSet = new Set(schedule.map((d) => startOfDay(d).toISOString()));
    const toDelete = existingPeriods.filter(
      (p) => !reconciledPeriodIds.has(p.id) && !scheduleSet.has(startOfDay(p.paydayDate).toISOString())
    );
    if (toDelete.length > 0) {
      await prisma.payPeriod.deleteMany({ where: { id: { in: toDelete.map((p) => p.id) } } });
    }

    const existingDates = new Set(
      existingPeriods.filter((p) => !toDelete.find((d) => d.id === p.id)).map((p) => startOfDay(p.paydayDate).toISOString())
    );

    // Create missing periods
    let created = 0;
    if (isMonthly) {
      const toCreate = periods.filter((p) => !existingDates.has(startOfDay(p.paydayDate).toISOString()));
      if (toCreate.length > 0) {
        await prisma.payPeriod.createMany({
          data: toCreate.map((p) => ({ accountId, paydayDate: p.paydayDate, startDate: p.startDate, endDate: p.endDate, openingBalance: 0 })),
        });
        created = toCreate.length;
      }
      // Always populate ALL current periods (upsert skips already-populated rows)
      const allCurrentPeriods = await prisma.payPeriod.findMany({
        where: { accountId },
        orderBy: { paydayDate: 'asc' },
        select: { startDate: true, endDate: true, paydayDate: true },
      });
      await populateNewMonthlyPeriods(allCurrentPeriods, accountId);
    } else {
      const toCreateDates = schedule.filter((d) => !existingDates.has(d.toISOString()));
      const periodLength = getPeriodLengthDays(frequency);
      if (toCreateDates.length > 0) {
        await prisma.payPeriod.createMany({
          data: toCreateDates.map((paydayDate) => ({
            accountId,
            paydayDate,
            startDate: paydayDate,
            endDate: addDays(paydayDate, periodLength - 1),
            openingBalance: 0,
          })),
        });
        created = toCreateDates.length;
      }
      // Always populate ALL current periods (upsert skips already-populated rows)
      const allCurrentPaydays = (await prisma.payPeriod.findMany({
        where: { accountId },
        orderBy: { paydayDate: 'asc' },
        select: { paydayDate: true },
      })).map((p) => p.paydayDate);
      await populateNewPeriods(allCurrentPaydays, periodLength, accountId);
    }

    // Set opening balance on the earliest unreconciled period
    const firstUnreconciled = await prisma.payPeriod.findFirst({
      where: { accountId, id: { notIn: [...reconciledPeriodIds] } },
      orderBy: { paydayDate: 'asc' },
    });
    if (firstUnreconciled) {
      await prisma.payPeriod.update({ where: { id: firstUnreconciled.id }, data: { openingBalance: openingBal } });
      const affectedIds = await recomputeFromPeriod(firstUnreconciled.id);
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
    }

    res.json({
      success: true,
      created,
      deleted: toDelete.length,
      message: `Pay periods regenerated: ${created} created, ${toDelete.length} removed`,
    });
  } catch (err: any) {
    console.error('[regenerate-periods]', err);
    res.status(500).json({ error: err.message || 'Failed to regenerate periods' });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function computePeriodCount(frequency: string, years: number): number {
  switch (frequency) {
    case 'weekly':    return Math.ceil((years * 365) / 7);
    case 'biweekly':  return Math.ceil((years * 365) / 14);
    case 'monthly':   return years * 12;
    default:          return Math.ceil((years * 365) / 14);
  }
}

function buildBiweeklySchedule(anchor: Date, frequency: string, count: number): Date[] {
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
    case 'weekly':   return 7;
    case 'biweekly': return 14;
    case 'monthly':  return 30;
    default:         return 14;
  }
}

/** For newly created bi-weekly/weekly pay periods: generate bill instances and income entries */
async function populateNewPeriods(newPaydays: Date[], periodLength: number, accountId: string): Promise<void> {
  if (newPaydays.length === 0) return;

  const [activeBills, activeSources] = await Promise.all([
    prisma.billTemplate.findMany({ where: { accountId, isActive: true } }),
    prisma.incomeSource.findMany({ where: { accountId, isActive: true } }),
  ]);

  const { billFallsInPeriod, getBillAmountForMonth, incomeFallsInPeriod } = await import('../services/projectionEngine');

  for (const payday of newPaydays) {
    const period = await prisma.payPeriod.findFirst({ where: { accountId, paydayDate: payday } });
    if (!period) continue;

    const year  = payday.getFullYear();
    const month = payday.getMonth() + 1;

    for (const bill of activeBills) {
      if (bill.dueDayOfMonth === null) continue;
      if (!billFallsInPeriod(bill.dueDayOfMonth, period.startDate, period.endDate)) continue;
      const amount = await getBillAmountForMonth(bill.id, year, month);
      await prisma.billInstance.upsert({
        where: { payPeriodId_billTemplateId: { payPeriodId: period.id, billTemplateId: bill.id } },
        create: { accountId, payPeriodId: period.id, billTemplateId: bill.id, projectedAmount: amount },
        update: {},
      });
    }

    for (const source of activeSources) {
      if (source.type === 'MONTHLY_RECURRING' && source.dayOfMonth !== null) {
        if (!incomeFallsInPeriod(source.dayOfMonth, period.startDate, period.endDate)) continue;
      }
      if (source.type === 'AD_HOC') continue;
      await prisma.incomeEntry.upsert({
        where: { payPeriodId_incomeSourceId: { payPeriodId: period.id, incomeSourceId: source.id } },
        create: { accountId, payPeriodId: period.id, incomeSourceId: source.id, projectedAmount: source.defaultAmount },
        update: {},
      });
    }
  }
}

/** For newly created monthly periods: generate bill instances and income entries.
 *  Monthly periods cover 1st–last day of month, so bills due any day fall in the period.
 *  Income sources use expectedDayOfMonth for business clients.
 */
async function populateNewMonthlyPeriods(
  newPeriods: Array<{ startDate: Date; endDate: Date; paydayDate: Date }>,
  accountId: string
): Promise<void> {
  if (newPeriods.length === 0) return;

  const [activeBills, activeSources] = await Promise.all([
    prisma.billTemplate.findMany({ where: { accountId, isActive: true } }),
    prisma.incomeSource.findMany({ where: { accountId, isActive: true } }),
  ]);

  for (const { paydayDate } of newPeriods) {
    const period = await prisma.payPeriod.findFirst({ where: { accountId, paydayDate } });
    if (!period) continue;

    // In a monthly period every fixed bill falls in — the whole month is covered
    for (const bill of activeBills) {
      if (bill.dueDayOfMonth === null && !bill.isDiscretionary) continue; // skip truly discretionary
      if (bill.isDiscretionary) continue;
      const year  = paydayDate.getFullYear();
      const month = paydayDate.getMonth() + 1;
      const amount = await prisma.billMonthlyAmount
        .findUnique({ where: { billTemplateId_year_month: { billTemplateId: bill.id, year, month } } })
        .then((m) => m?.amount ?? bill.defaultAmount);
      await prisma.billInstance.upsert({
        where: { payPeriodId_billTemplateId: { payPeriodId: period.id, billTemplateId: bill.id } },
        create: { accountId, payPeriodId: period.id, billTemplateId: bill.id, projectedAmount: amount },
        update: {},
      });
    }

    // Every active income source gets one entry per monthly period
    for (const source of activeSources) {
      if (source.type === 'AD_HOC') continue;
      await prisma.incomeEntry.upsert({
        where: { payPeriodId_incomeSourceId: { payPeriodId: period.id, incomeSourceId: source.id } },
        create: { accountId, payPeriodId: period.id, incomeSourceId: source.id, projectedAmount: source.defaultAmount },
        update: {},
      });
    }
  }
}

export default router;
