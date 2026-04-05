/**
 * FlowCast Projection Engine
 *
 * Core business logic for computing the cash flow projection grid.
 *
 * Phase 5: recomputeFromPeriod is now account-scoped (reads accountId from the
 * period record itself). buildMonthlyPeriods() added for monthly-account period generation.
 */

import { isWithinInterval, setDate, getYear, getMonth, endOfMonth } from 'date-fns';
import prisma from '../models/prisma';

export interface PeriodProjection {
  payPeriodId: string;
  paydayDate: Date;
  startDate: Date;
  endDate: Date;
  plannedBalance: number;
  runningBalance: number;
  actualBalance: number;
  difference: number;
  totalIncome: number;
  totalExpenses: number;
  bills: BillProjection[];
  income: IncomeProjection[];
}

export interface BillProjection {
  billInstanceId: string;
  billTemplateId: string;
  name: string;
  group: string;
  dueDayOfMonth: number | null;
  projectedAmount: number;
  actualAmount: number | null;
  isReconciled: boolean;
  isFrozen: boolean;
}

export interface IncomeProjection {
  incomeEntryId: string;
  incomeSourceId: string;
  name: string;
  type: string;
  projectedAmount: number;
  actualAmount: number | null;
  isReconciled: boolean;
}

export function billFallsInPeriod(dueDayOfMonth: number, periodStart: Date, periodEnd: Date): boolean {
  const checkMonth = (year: number, month: number): boolean => {
    try {
      const dueDate = setDate(new Date(year, month - 1, 1), dueDayOfMonth);
      return isWithinInterval(dueDate, { start: periodStart, end: periodEnd });
    } catch { return false; }
  };
  const startYear = getYear(periodStart);
  const startMonth = getMonth(periodStart) + 1;
  const nextMonth = startMonth === 12 ? 1 : startMonth + 1;
  const nextYear = startMonth === 12 ? startYear + 1 : startYear;
  return checkMonth(startYear, startMonth) || checkMonth(nextYear, nextMonth);
}

export function incomeFallsInPeriod(dayOfMonth: number, periodStart: Date, periodEnd: Date): boolean {
  const checkMonth = (year: number, month: number): boolean => {
    try {
      const incomeDate = setDate(new Date(year, month - 1, 1), dayOfMonth);
      return isWithinInterval(incomeDate, { start: periodStart, end: periodEnd });
    } catch { return false; }
  };
  const startYear  = getYear(periodStart);
  const startMonth = getMonth(periodStart) + 1;
  const nextMonth  = startMonth === 12 ? 1 : startMonth + 1;
  const nextYear   = startMonth === 12 ? startYear + 1 : startYear;
  return checkMonth(startYear, startMonth) || checkMonth(nextYear, nextMonth);
}

export async function getBillAmountForMonth(billTemplateId: string, year: number, month: number): Promise<number> {
  const monthly = await prisma.billMonthlyAmount.findUnique({
    where: { billTemplateId_year_month: { billTemplateId, year, month } },
  });
  if (monthly) return monthly.amount;
  const template = await prisma.billTemplate.findUnique({ where: { id: billTemplateId } });
  return template?.defaultAmount ?? 0;
}

export async function computePeriodProjection(
  payPeriodId: string,
  previousBalance: number,
  previousActualBalance?: number,
): Promise<PeriodProjection> {
  const payPeriod = await prisma.payPeriod.findUniqueOrThrow({
    where: { id: payPeriodId },
    include: {
      billInstances: { include: { billTemplate: true } },
      incomeEntries: { include: { incomeSource: true } },
    },
  });

  const incomeProjections: IncomeProjection[] = payPeriod.incomeEntries.map((entry) => ({
    incomeEntryId: entry.id,
    incomeSourceId: entry.incomeSourceId,
    name: entry.incomeSource.name,
    type: entry.incomeSource.type,
    projectedAmount: entry.projectedAmount,
    actualAmount: entry.actualAmount,
    isReconciled: entry.isReconciled,
  }));

  const billProjections: BillProjection[] = payPeriod.billInstances
    .filter((instance) => instance.isReconciled || instance.billTemplate.isActive)
    .map((instance) => ({
      billInstanceId: instance.id,
      billTemplateId: instance.billTemplateId,
      name: instance.billTemplate.name,
      group: instance.billTemplate.group,
      dueDayOfMonth: instance.billTemplate.dueDayOfMonth,
      projectedAmount: instance.projectedAmount,
      actualAmount: instance.actualAmount,
      isReconciled: instance.isReconciled,
      isFrozen: instance.isFrozen,
    }));

  const totalProjectedIncome = incomeProjections.reduce((sum, e) => sum + e.projectedAmount, 0);
  const totalActualIncome = incomeProjections.filter((e) => e.isReconciled).reduce((sum, e) => sum + (e.actualAmount ?? e.projectedAmount), 0);
  const totalUnreconciledIncome = incomeProjections.filter((e) => !e.isReconciled).reduce((sum, e) => sum + e.projectedAmount, 0);

  const totalProjectedExpenses = billProjections.reduce((sum, b) => sum + b.projectedAmount, 0);
  const totalActualExpenses = billProjections.filter((b) => b.isReconciled).reduce((sum, b) => sum + (b.actualAmount ?? b.projectedAmount), 0);
  const totalUnreconciledExpenses = billProjections.filter((b) => !b.isReconciled).reduce((sum, b) => sum + b.projectedAmount, 0);

  const plannedBalance = previousBalance + totalProjectedIncome - totalProjectedExpenses;
  const runningBalance = previousBalance + totalActualIncome + totalUnreconciledIncome - totalActualExpenses - totalUnreconciledExpenses;
  const prevActual = previousActualBalance ?? previousBalance;
  const actualBalance = prevActual + totalActualIncome - totalActualExpenses;

  return {
    payPeriodId,
    paydayDate: payPeriod.paydayDate,
    startDate: payPeriod.startDate,
    endDate: payPeriod.endDate,
    plannedBalance,
    runningBalance,
    actualBalance,
    difference: plannedBalance - runningBalance,
    totalIncome: totalProjectedIncome,
    totalExpenses: totalProjectedExpenses,
    bills: billProjections,
    income: incomeProjections,
  };
}

/**
 * Recompute all balance snapshots from a given pay period forward.
 * Phase 5: automatically scoped to the account that owns fromPayPeriodId.
 */
export async function recomputeFromPeriod(fromPayPeriodId: string): Promise<string[]> {
  const fromPeriod = await prisma.payPeriod.findUniqueOrThrow({ where: { id: fromPayPeriodId } });
  const { accountId } = fromPeriod;

  const periodsToRecompute = await prisma.payPeriod.findMany({
    where: { accountId, paydayDate: { gte: fromPeriod.paydayDate } },
    orderBy: { paydayDate: 'asc' },
  });

  const previousPeriod = await prisma.payPeriod.findFirst({
    where: { accountId, paydayDate: { lt: fromPeriod.paydayDate } },
    orderBy: { paydayDate: 'desc' },
    include: { balanceSnapshot: true },
  });

  let runningBalance = previousPeriod?.balanceSnapshot?.runningBalance ?? fromPeriod.openingBalance;
  let actualBalance = previousPeriod?.balanceSnapshot?.actualBalance ?? fromPeriod.openingBalance;

  const affectedIds: string[] = [];

  for (const period of periodsToRecompute) {
    const projection = await computePeriodProjection(period.id, runningBalance, actualBalance);

    await prisma.balanceSnapshot.upsert({
      where: { payPeriodId: period.id },
      create: {
        accountId,
        payPeriodId: period.id,
        plannedBalance: projection.plannedBalance,
        runningBalance: projection.runningBalance,
        actualBalance: projection.actualBalance,
        totalIncome: projection.totalIncome,
        totalExpenses: projection.totalExpenses,
        isStale: false,
        computedAt: new Date(),
      },
      update: {
        plannedBalance: projection.plannedBalance,
        runningBalance: projection.runningBalance,
        actualBalance: projection.actualBalance,
        totalIncome: projection.totalIncome,
        totalExpenses: projection.totalExpenses,
        isStale: false,
        computedAt: new Date(),
      },
    });

    runningBalance = projection.runningBalance;
    actualBalance = projection.actualBalance;
    affectedIds.push(period.id);
  }

  return affectedIds;
}

/**
 * Build a monthly period schedule for a monthly-type account.
 * Each period: startDate = 1st of month, endDate = paydayDate = last day of month.
 */
export function buildMonthlyPeriods(
  anchorYear: number,
  anchorMonth: number, // 1-indexed
  count: number
): Array<{ startDate: Date; endDate: Date; paydayDate: Date }> {
  const periods: Array<{ startDate: Date; endDate: Date; paydayDate: Date }> = [];
  for (let i = 0; i < count; i++) {
    const totalMonths = (anchorMonth - 1) + i;
    const year  = anchorYear + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;
    const startDate  = new Date(year, month - 1, 1);
    const lastDay    = endOfMonth(startDate);
    const endDate    = new Date(year, month - 1, lastDay.getDate());
    const paydayDate = endDate;
    periods.push({ startDate, endDate, paydayDate });
  }
  return periods;
}
