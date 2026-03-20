/**
 * Auto-match engine
 *
 * Given a transaction description, finds the best matching AutoMatchRule
 * and returns the target (billTemplateId or incomeSourceId).
 *
 * Rules are evaluated in descending priority order. First match wins.
 */

import prisma from '../models/prisma';

export interface AutoMatchResult {
  targetType: 'BILL' | 'INCOME';
  targetId: string;
  ruleId: string;
}

function testRule(description: string, pattern: string, matchType: string): boolean {
  const haystack = description.toLowerCase();
  const needle = pattern.toLowerCase();

  switch (matchType) {
    case 'CONTAINS':
      return haystack.includes(needle);
    case 'STARTS_WITH':
      return haystack.startsWith(needle);
    case 'REGEX':
      try {
        return new RegExp(pattern, 'i').test(description);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export async function findAutoMatch(description: string): Promise<AutoMatchResult | null> {
  const rules = await prisma.autoMatchRule.findMany({
    where: { isActive: true },
    orderBy: { priority: 'desc' },
  });

  for (const rule of rules) {
    if (testRule(description, rule.pattern, rule.matchType)) {
      return {
        targetType: rule.targetType as 'BILL' | 'INCOME',
        targetId: rule.targetId,
        ruleId: rule.id,
      };
    }
  }

  return null;
}

/**
 * Find candidate bill instances or income entries within ±14 days of the
 * transaction date that are unreconciled and match the target template/source.
 */
export async function findMatchCandidates(
  date: Date,
  amount: number,
  windowDays = 14,
): Promise<{
  bills: { id: string; payPeriodId: string; templateName: string; projectedAmount: number; paydayDate: Date }[];
  income: { id: string; payPeriodId: string; sourceName: string; projectedAmount: number; paydayDate: Date }[];
}> {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const from = new Date(date.getTime() - windowMs);
  const to = new Date(date.getTime() + windowMs);

  const [bills, income] = await Promise.all([
    prisma.billInstance.findMany({
      where: {
        isReconciled: false,
        payPeriod: { paydayDate: { gte: from, lte: to } },
      },
      include: {
        billTemplate: { select: { name: true } },
        payPeriod: { select: { paydayDate: true } },
      },
      orderBy: { payPeriod: { paydayDate: 'asc' } },
    }),
    prisma.incomeEntry.findMany({
      where: {
        isReconciled: false,
        payPeriod: { paydayDate: { gte: from, lte: to } },
      },
      include: {
        incomeSource: { select: { name: true } },
        payPeriod: { select: { paydayDate: true } },
      },
      orderBy: { payPeriod: { paydayDate: 'asc' } },
    }),
  ]);

  // For expenses (negative amount) suggest bill instances; for income (positive) suggest income entries
  return {
    bills: amount < 0
      ? bills.map((b) => ({
          id: b.id,
          payPeriodId: b.payPeriodId,
          templateName: b.billTemplate.name,
          projectedAmount: b.projectedAmount,
          paydayDate: b.payPeriod.paydayDate,
        }))
      : [],
    income: amount > 0
      ? income.map((e) => ({
          id: e.id,
          payPeriodId: e.payPeriodId,
          sourceName: e.incomeSource.name,
          projectedAmount: e.projectedAmount,
          paydayDate: e.payPeriod.paydayDate,
        }))
      : [],
  };
}
