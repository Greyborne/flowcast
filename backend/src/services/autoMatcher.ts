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

export interface MatchCandidate {
  kind: 'INSTANCE' | 'TEMPLATE';
  id: string;            // billInstanceId or billTemplateId (for TEMPLATE kind)
  templateId: string;    // always the billTemplateId or incomeSourceId
  payPeriodId: string | null;
  name: string;
  projectedAmount: number;
  paydayDate: Date | null;
  type: 'BILL' | 'INCOME';
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
 * Find match candidates for a transaction.
 *
 * - No search: unreconciled instances within ±14 days of transaction date.
 * - With search: ALL unreconciled instances matching the name, plus active
 *   templates/sources that have no instance in any period (discretionary
 *   expenses like restaurant, grocery, etc.).
 *
 * Negative amount → suggest bills/expenses.
 * Positive amount → suggest income entries.
 */
/** Find the pay period containing `date` (startDate ≤ date ≤ endDate).
 *  Falls back to the earliest future period, then the latest past period. */
async function containingPeriod(date: Date) {
  return (
    (await prisma.payPeriod.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date } },
    })) ??
    (await prisma.payPeriod.findFirst({
      where: { paydayDate: { gte: date } },
      orderBy: { paydayDate: 'asc' },
    })) ??
    (await prisma.payPeriod.findFirst({ orderBy: { paydayDate: 'desc' } }))
  );
}

export async function findMatchCandidates(
  date: Date,
  amount: number,
  search?: string,
): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];
  const isExpense = amount < 0;

  if (isExpense) {
    const period = await containingPeriod(date);
    if (!period) return candidates;

    if (search && search.trim().length > 0) {
      // Search mode: instances in the containing period matching name + templates with no
      // instance in this period (so the backend can upsert one in the right period).
      const term = search.trim().toLowerCase();

      const instances = await prisma.billInstance.findMany({
        where: {
          isReconciled: false,
          payPeriodId: period.id,
          billTemplate: { name: { contains: term }, isActive: true },
        },
        include: {
          billTemplate: { select: { id: true, name: true, defaultAmount: true } },
          payPeriod: { select: { id: true, paydayDate: true } },
        },
        orderBy: { billTemplate: { name: 'asc' } },
      });

      const instancedTemplateIds = new Set(instances.map((i) => i.billTemplateId));

      for (const inst of instances) {
        candidates.push({
          kind: 'INSTANCE',
          id: inst.id,
          templateId: inst.billTemplateId,
          payPeriodId: inst.payPeriodId,
          name: inst.billTemplate.name,
          projectedAmount: inst.projectedAmount,
          paydayDate: inst.payPeriod.paydayDate,
          type: 'BILL',
        });
      }

      // Templates not yet instanced in this period — backend will create the instance
      // in the correct period when matched.
      const templates = await prisma.billTemplate.findMany({
        where: { isActive: true, name: { contains: term } },
        orderBy: { name: 'asc' },
      });
      for (const tmpl of templates) {
        if (!instancedTemplateIds.has(tmpl.id)) {
          candidates.push({
            kind: 'TEMPLATE',
            id: tmpl.id,
            templateId: tmpl.id,
            payPeriodId: null,
            name: tmpl.name,
            projectedAmount: tmpl.defaultAmount,
            paydayDate: null,
            type: 'BILL',
          });
        }
      }
    } else {
      // Default mode: all unreconciled instances in the containing period
      const instances = await prisma.billInstance.findMany({
        where: {
          isReconciled: false,
          payPeriodId: period.id,
        },
        include: {
          billTemplate: { select: { id: true, name: true } },
          payPeriod: { select: { id: true, paydayDate: true } },
        },
        orderBy: { billTemplate: { name: 'asc' } },
      });

      for (const inst of instances) {
        candidates.push({
          kind: 'INSTANCE',
          id: inst.id,
          templateId: inst.billTemplateId,
          payPeriodId: inst.payPeriodId,
          name: inst.billTemplate.name,
          projectedAmount: inst.projectedAmount,
          paydayDate: inst.payPeriod.paydayDate,
          type: 'BILL',
        });
      }
    }
  } else {
    const period = await containingPeriod(date);
    if (!period) return candidates;

    if (search && search.trim().length > 0) {
      const term = search.trim().toLowerCase();

      const entries = await prisma.incomeEntry.findMany({
        where: {
          isReconciled: false,
          payPeriodId: period.id,
          incomeSource: { name: { contains: term }, isActive: true },
        },
        include: {
          incomeSource: { select: { id: true, name: true, defaultAmount: true } },
          payPeriod: { select: { id: true, paydayDate: true } },
        },
        orderBy: { incomeSource: { name: 'asc' } },
      });

      for (const entry of entries) {
        candidates.push({
          kind: 'INSTANCE',
          id: entry.id,
          templateId: entry.incomeSourceId,
          payPeriodId: entry.payPeriodId,
          name: entry.incomeSource.name,
          projectedAmount: entry.projectedAmount,
          paydayDate: entry.payPeriod.paydayDate,
          type: 'INCOME',
        });
      }

      // Sources not yet instanced in this period
      const instancedSourceIds = new Set(entries.map((e) => e.incomeSourceId));
      const sources = await prisma.incomeSource.findMany({
        where: { isActive: true, name: { contains: term } },
        orderBy: { name: 'asc' },
      });
      for (const source of sources) {
        if (!instancedSourceIds.has(source.id)) {
          candidates.push({
            kind: 'TEMPLATE',
            id: source.id,
            templateId: source.id,
            payPeriodId: null,
            name: source.name,
            projectedAmount: source.defaultAmount,
            paydayDate: null,
            type: 'INCOME',
          });
        }
      }
    } else {
      // Default mode: all unreconciled income entries in the containing period
      const entries = await prisma.incomeEntry.findMany({
        where: {
          isReconciled: false,
          payPeriodId: period.id,
        },
        include: {
          incomeSource: { select: { id: true, name: true } },
          payPeriod: { select: { id: true, paydayDate: true } },
        },
        orderBy: { incomeSource: { name: 'asc' } },
      });

      for (const entry of entries) {
        candidates.push({
          kind: 'INSTANCE',
          id: entry.id,
          templateId: entry.incomeSourceId,
          payPeriodId: entry.payPeriodId,
          name: entry.incomeSource.name,
          projectedAmount: entry.projectedAmount,
          paydayDate: entry.payPeriod.paydayDate,
          type: 'INCOME',
        });
      }
    }
  }

  return candidates;
}
