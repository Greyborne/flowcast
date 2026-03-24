/**
 * FlowCast Projection Engine
 *
 * Core business logic for computing the cash flow projection grid.
 *
 * Replaces the Google Sheets ISBETWEEN/VLOOKUP formula grid with a single
 * server-side computation that runs in milliseconds for a 2-year window.
 *
 * Algorithm (mirrors the spreadsheet's ISBETWEEN logic):
 *   For each bill with a dueDayOfMonth (DOT) and each pay period [start, end]:
 *     Check if DATE(year, month, DOT+1) falls within [periodStart, periodEnd)
 *     Also check the next month (periods can span month boundaries)
 *     If match: include this bill's monthly amount in this pay period
 */

import { addDays, isWithinInterval, setDate, addMonths, getYear, getMonth } from 'date-fns';
import prisma from '../models/prisma';

export interface PeriodProjection {
  payPeriodId: string;
  paydayDate: Date;
  startDate: Date;
  endDate: Date;
  plannedBalance: number;
  runningBalance: number;
  actualBalance: number; // reconciled actuals only — what you actually have in the bank
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

/**
 * Determines if a bill with a given due day falls within a pay period.
 * Mirrors the ISBETWEEN(DATE(YEAR(periodStart), MONTH(periodStart), DOT+1), periodStart, periodEnd-1) logic.
 */
export function billFallsInPeriod(
  dueDayOfMonth: number,
  periodStart: Date,
  periodEnd: Date
): boolean {
  const checkMonth = (year: number, month: number): boolean => {
    try {
      const dueDate = setDate(new Date(year, month - 1, 1), dueDayOfMonth);
      return isWithinInterval(dueDate, {
        start: periodStart,
        end: periodEnd,
      });
    } catch {
      return false;
    }
  };

  const startYear = getYear(periodStart);
  const startMonth = getMonth(periodStart) + 1; // 1-indexed

  // Check current month and next month (handles period spanning month boundary)
  const nextMonth = startMonth === 12 ? 1 : startMonth + 1;
  const nextYear = startMonth === 12 ? startYear + 1 : startYear;

  return checkMonth(startYear, startMonth) || checkMonth(nextYear, nextMonth);
}

/**
 * Determines if a MONTHLY_RECURRING income source falls within a pay period.
 * Uses the source's dayOfMonth directly (no +1 offset like bills use).
 */
export function incomeFallsInPeriod(
  dayOfMonth: number,
  periodStart: Date,
  periodEnd: Date
): boolean {
  const checkMonth = (year: number, month: number): boolean => {
    try {
      const incomeDate = setDate(new Date(year, month - 1, 1), dayOfMonth);
      return isWithinInterval(incomeDate, {
        start: periodStart,
        end: periodEnd,          // inclusive — income has no DOT+1 offset unlike bills
      });
    } catch {
      return false;
    }
  };

  const startYear  = getYear(periodStart);
  const startMonth = getMonth(periodStart) + 1;
  const nextMonth  = startMonth === 12 ? 1 : startMonth + 1;
  const nextYear   = startMonth === 12 ? startYear + 1 : startYear;

  return checkMonth(startYear, startMonth) || checkMonth(nextYear, nextMonth);
}

/**
 * Get the projected amount for a bill in a given month from BillMonthlyAmount.
 * Falls back to the template's defaultAmount if no monthly override exists.
 */
export async function getBillAmountForMonth(
  billTemplateId: string,
  year: number,
  month: number
): Promise<number> {
  const monthly = await prisma.billMonthlyAmount.findUnique({
    where: { billTemplateId_year_month: { billTemplateId, year, month } },
  });

  if (monthly) return monthly.amount;

  // Fall back to template default
  const template = await prisma.billTemplate.findUnique({ where: { id: billTemplateId } });
  return template?.defaultAmount ?? 0;
}

/**
 * Compute the full projection for a single pay period.
 * Returns planned, running, and actual balances along with all bill/income line items.
 *
 * - plannedBalance: based purely on projected amounts (what you planned to have)
 * - runningBalance: actuals for reconciled + projected for unreconciled (best estimate)
 * - actualBalance: only actual reconciled amounts (what you really have in the bank)
 */
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

  // ── Income ───────────────────────────────────────────────────────────────
  const incomeProjections: IncomeProjection[] = payPeriod.incomeEntries.map((entry) => ({
    incomeEntryId: entry.id,
    incomeSourceId: entry.incomeSourceId,
    name: entry.incomeSource.name,
    type: entry.incomeSource.type,
    projectedAmount: entry.projectedAmount,
    actualAmount: entry.actualAmount,
    isReconciled: entry.isReconciled,
  }));

  // ── Bills ─────────────────────────────────────────────────────────────────
  // Exclude unreconciled instances of archived templates — they won't be paid.
  // Reconciled instances are always included regardless of template status (actual money was spent).
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

  // ── Balance Calculation ───────────────────────────────────────────────────
  const totalProjectedIncome = incomeProjections.reduce((sum, e) => sum + e.projectedAmount, 0);
  const totalActualIncome = incomeProjections
    .filter((e) => e.isReconciled)
    .reduce((sum, e) => sum + (e.actualAmount ?? e.projectedAmount), 0);
  const totalUnreconciledIncome = incomeProjections
    .filter((e) => !e.isReconciled)
    .reduce((sum, e) => sum + e.projectedAmount, 0);

  const totalProjectedExpenses = billProjections.reduce((sum, b) => sum + b.projectedAmount, 0);
  const totalActualExpenses = billProjections
    .filter((b) => b.isReconciled)
    .reduce((sum, b) => sum + (b.actualAmount ?? b.projectedAmount), 0);
  const totalUnreconciledExpenses = billProjections
    .filter((b) => !b.isReconciled)
    .reduce((sum, b) => sum + b.projectedAmount, 0);

  // Planned balance: based purely on projected amounts
  const plannedBalance =
    previousBalance + totalProjectedIncome - totalProjectedExpenses;

  // Running balance: actuals for reconciled + projected for unreconciled
  const runningBalance =
    previousBalance +
    totalActualIncome +
    totalUnreconciledIncome -
    totalActualExpenses -
    totalUnreconciledExpenses;

  // Actual balance: only actual reconciled amounts — mirrors your real bank statement
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
 * Called after any reconciliation. Returns updated snapshots for WebSocket broadcast.
 */
export async function recomputeFromPeriod(fromPayPeriodId: string): Promise<string[]> {
  // Get all pay periods from the affected one forward, ordered by date
  const fromPeriod = await prisma.payPeriod.findUniqueOrThrow({
    where: { id: fromPayPeriodId },
  });

  const periodsToRecompute = await prisma.payPeriod.findMany({
    where: { paydayDate: { gte: fromPeriod.paydayDate } },
    orderBy: { paydayDate: 'asc' },
  });

  // Get the balance just before the from period
  const previousPeriod = await prisma.payPeriod.findFirst({
    where: { paydayDate: { lt: fromPeriod.paydayDate } },
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
