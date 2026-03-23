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

/**
 * For search-mode results, filter instances per template:
 * - If any past (paydayDate <= today) unreconciled instances exist → keep only those.
 * - Otherwise → keep only the single next upcoming instance.
 */
/**
 * For each source/template, keep only the single most-relevant entry relative to txnDate:
 *   - Most recent past entry (paydayDate <= txnDate), OR
 *   - Earliest future entry if no past entry exists.
 * This prevents showing Feb 26 as a candidate when matching a Feb 25 transaction.
 */
function filterByDate(txnDate: Date, instances: MatchCandidate[]): MatchCandidate[] {
  const byTemplate = new Map<string, MatchCandidate[]>();
  for (const inst of instances) {
    const list = byTemplate.get(inst.templateId) ?? [];
    list.push(inst);
    byTemplate.set(inst.templateId, list);
  }

  const result: MatchCandidate[] = [];
  for (const list of byTemplate.values()) {
    const past = list.filter((i) => i.paydayDate && i.paydayDate <= txnDate);
    if (past.length > 0) {
      // Keep only the most recent past entry
      past.sort((a, b) => b.paydayDate!.getTime() - a.paydayDate!.getTime());
      result.push(past[0]);
    } else {
      // No past entries — take only the earliest future one
      const future = list.filter((i) => i.paydayDate && i.paydayDate > txnDate);
      future.sort((a, b) => a.paydayDate!.getTime() - b.paydayDate!.getTime());
      if (future.length > 0) result.push(future[0]);
    }
  }
  return result;
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
export async function findMatchCandidates(
  date: Date,
  amount: number,
  search?: string,
  windowDays = 14,
): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];
  const isExpense = amount < 0;

  if (isExpense) {
    if (search && search.trim().length > 0) {
      // Search mode: all unreconciled instances matching name + discretionary templates
      const term = search.trim().toLowerCase();

      const instances = await prisma.billInstance.findMany({
        where: {
          isReconciled: false,
          billTemplate: { name: { contains: term }, isActive: true },
        },
        include: {
          billTemplate: { select: { id: true, name: true, defaultAmount: true } },
          payPeriod: { select: { id: true, paydayDate: true } },
        },
        orderBy: { payPeriod: { paydayDate: 'asc' } },
      });

      const instancedTemplateIds = new Set(instances.map((i) => i.billTemplateId));

      // Also include templates not already represented by an unreconciled instance above.
      // This covers: (a) truly discretionary templates with no instances ever, and
      // (b) templates whose instances are all reconciled — user can still match to them
      // and the backend will create/upsert an instance for the right pay period.
      const templates = await prisma.billTemplate.findMany({
        where: {
          isActive: true,
          name: { contains: term },
        },
      });

      // Map to candidate shape, then filter to past-only or next-future-only per template
      const mapped = instances.map((inst) => ({
        kind: 'INSTANCE' as const,
        id: inst.id,
        templateId: inst.billTemplateId,
        payPeriodId: inst.payPeriodId,
        name: inst.billTemplate.name,
        projectedAmount: inst.projectedAmount,
        paydayDate: inst.payPeriod.paydayDate,
        type: 'BILL' as const,
      }));

      for (const inst of filterByDate(date, mapped)) {
        candidates.push(inst);
      }

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
      // Date-window mode: ±14 days
      const windowMs = windowDays * 24 * 60 * 60 * 1000;
      const from = new Date(date.getTime() - windowMs);
      const to = new Date(date.getTime() + windowMs);

      const instances = await prisma.billInstance.findMany({
        where: {
          isReconciled: false,
          payPeriod: { paydayDate: { gte: from, lte: to } },
        },
        include: {
          billTemplate: { select: { id: true, name: true } },
          payPeriod: { select: { id: true, paydayDate: true } },
        },
        orderBy: [{ billTemplate: { name: 'asc' } }, { payPeriod: { paydayDate: 'asc' } }],
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
    if (search && search.trim().length > 0) {
      const term = search.trim().toLowerCase();

      const entries = await prisma.incomeEntry.findMany({
        where: {
          isReconciled: false,
          incomeSource: { name: { contains: term }, isActive: true },
        },
        include: {
          incomeSource: { select: { id: true, name: true, defaultAmount: true } },
          payPeriod: { select: { id: true, paydayDate: true } },
        },
        orderBy: { payPeriod: { paydayDate: 'asc' } },
      });

      const mappedIncome = entries.map((entry) => ({
        kind: 'INSTANCE' as const,
        id: entry.id,
        templateId: entry.incomeSourceId,
        payPeriodId: entry.payPeriodId,
        name: entry.incomeSource.name,
        projectedAmount: entry.projectedAmount,
        paydayDate: entry.payPeriod.paydayDate,
        type: 'INCOME' as const,
      }));

      for (const entry of filterByDate(date, mappedIncome)) {
        candidates.push(entry);
      }

      // Also show income sources not represented by any unreconciled entry —
      // covers sources where all entries are reconciled (ad-hoc / reusable).
      const instancedSourceIds = new Set(entries.map((e) => e.incomeSourceId));
      const sources = await prisma.incomeSource.findMany({
        where: { isActive: true, name: { contains: term } },
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
      const windowMs = windowDays * 24 * 60 * 60 * 1000;
      const from = new Date(date.getTime() - windowMs);
      const to = new Date(date.getTime() + windowMs);

      const entries = await prisma.incomeEntry.findMany({
        where: {
          isReconciled: false,
          payPeriod: { paydayDate: { gte: from, lte: to } },
        },
        include: {
          incomeSource: { select: { id: true, name: true } },
          payPeriod: { select: { id: true, paydayDate: true } },
        },
        orderBy: [{ incomeSource: { name: 'asc' } }, { payPeriod: { paydayDate: 'asc' } }],
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
