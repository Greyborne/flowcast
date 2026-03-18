/**
 * FlowCast Cascade Service
 *
 * Handles W2 income propagation and balance cascade after reconciliation.
 *
 * Rules:
 *  - W2 income: when reconciled to a different amount, ALL future unreconciled
 *    W2 entries for that source are updated to the new amount, then balances cascade.
 *  - Monthly Recurring: reconcile only affects that instance (unless user opts to propagate).
 *  - Ad Hoc: reconcile affects only that instance, no propagation.
 *  - Bills: reconcile affects only that instance; future template amounts unchanged
 *    unless user explicitly updates the BillMonthlyAmount.
 */

import prisma from '../models/prisma';
import { recomputeFromPeriod } from './projectionEngine';
import { broadcast } from '../websocket/wsServer';

export interface ReconcileIncomePayload {
  incomeEntryId: string;
  actualAmount: number;
  notes?: string;
}

export interface ReconcileBillPayload {
  billInstanceId: string;
  actualAmount: number;
  notes?: string;
}

/**
 * Reconcile an income entry.
 * For W2 income with a changed amount, propagates to all future unreconciled entries.
 */
export async function reconcileIncome(payload: ReconcileIncomePayload): Promise<void> {
  const { incomeEntryId, actualAmount, notes } = payload;

  const entry = await prisma.incomeEntry.findUniqueOrThrow({
    where: { id: incomeEntryId },
    include: { incomeSource: true, payPeriod: true },
  });

  const previousAmount = entry.actualAmount ?? entry.projectedAmount;

  // Mark this entry as reconciled
  await prisma.incomeEntry.update({
    where: { id: incomeEntryId },
    data: {
      actualAmount,
      isReconciled: true,
      reconciledAt: new Date(),
      notes: notes ?? entry.notes,
    },
  });

  // Log the reconciliation
  await prisma.reconciliationLog.create({
    data: {
      resourceType: 'income',
      resourceId: incomeEntryId,
      action: 'reconcile',
      previousValue: previousAmount,
      newValue: actualAmount,
      periodsAffected: 1,
      notes,
    },
  });

  // W2 propagation: if amount changed, update ALL future unreconciled W2 entries
  let periodsAffected = 1;
  if (
    entry.incomeSource.type === 'W2' &&
    entry.incomeSource.propagateOnReconcile &&
    actualAmount !== entry.projectedAmount
  ) {
    const futureEntries = await prisma.incomeEntry.findMany({
      where: {
        incomeSourceId: entry.incomeSourceId,
        isReconciled: false,
        payPeriod: { paydayDate: { gt: entry.payPeriod.paydayDate } },
      },
    });

    if (futureEntries.length > 0) {
      await prisma.incomeEntry.updateMany({
        where: {
          id: { in: futureEntries.map((e) => e.id) },
        },
        data: { projectedAmount: actualAmount },
      });

      // Log propagation
      await prisma.reconciliationLog.create({
        data: {
          resourceType: 'income',
          resourceId: entry.incomeSourceId,
          action: 'propagate',
          previousValue: entry.projectedAmount,
          newValue: actualAmount,
          periodsAffected: futureEntries.length,
          notes: `W2 propagation from reconcile of ${incomeEntryId}`,
        },
      });

      // Also update the income source default amount
      await prisma.incomeSource.update({
        where: { id: entry.incomeSourceId },
        data: { defaultAmount: actualAmount },
      });

      periodsAffected += futureEntries.length;
    }
  }

  // Recompute all balances from this period forward and broadcast
  const affectedIds = await recomputeFromPeriod(entry.payPeriodId);
  broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });

  console.log(
    `[Cascade] Reconciled income ${incomeEntryId}: $${previousAmount} → $${actualAmount}. Periods affected: ${periodsAffected}`
  );
}

/**
 * Un-reconcile an income entry.
 */
export async function unreconcileIncome(incomeEntryId: string): Promise<void> {
  const entry = await prisma.incomeEntry.findUniqueOrThrow({
    where: { id: incomeEntryId },
  });

  await prisma.incomeEntry.update({
    where: { id: incomeEntryId },
    data: { isReconciled: false, actualAmount: null, reconciledAt: null },
  });

  await prisma.reconciliationLog.create({
    data: {
      resourceType: 'income',
      resourceId: incomeEntryId,
      action: 'unreconcile',
      previousValue: entry.actualAmount ?? entry.projectedAmount,
      newValue: null,
    },
  });

  const affectedIds = await recomputeFromPeriod(entry.payPeriodId);
  broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
}

/**
 * Reconcile a bill instance.
 * Freezes the record after reconciliation.
 */
export async function reconcileBill(payload: ReconcileBillPayload): Promise<void> {
  const { billInstanceId, actualAmount, notes } = payload;

  const instance = await prisma.billInstance.findUniqueOrThrow({
    where: { id: billInstanceId },
    include: { billTemplate: true },
  });

  if (instance.isFrozen) {
    throw new Error(`Bill instance ${billInstanceId} is frozen and cannot be modified.`);
  }

  const previousAmount = instance.actualAmount ?? instance.projectedAmount;

  await prisma.billInstance.update({
    where: { id: billInstanceId },
    data: {
      actualAmount,
      isReconciled: true,
      isFrozen: true,
      reconciledAt: new Date(),
      notes: notes ?? instance.notes,
    },
  });

  await prisma.reconciliationLog.create({
    data: {
      resourceType: 'bill',
      resourceId: billInstanceId,
      action: 'reconcile',
      previousValue: previousAmount,
      newValue: actualAmount,
      notes,
    },
  });

  const affectedIds = await recomputeFromPeriod(instance.payPeriodId);
  broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
}

/**
 * Un-reconcile (unfreeze) a bill instance.
 */
export async function unreconcileBill(billInstanceId: string): Promise<void> {
  const instance = await prisma.billInstance.findUniqueOrThrow({
    where: { id: billInstanceId },
  });

  await prisma.billInstance.update({
    where: { id: billInstanceId },
    data: { isReconciled: false, isFrozen: false, actualAmount: null, reconciledAt: null },
  });

  await prisma.reconciliationLog.create({
    data: {
      resourceType: 'bill',
      resourceId: billInstanceId,
      action: 'unreconcile',
      previousValue: instance.actualAmount ?? instance.projectedAmount,
      newValue: null,
    },
  });

  const affectedIds = await recomputeFromPeriod(instance.payPeriodId);
  broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
}

/**
 * Update the opening/current bank balance and recompute the entire projection.
 * This is the "Set Current Balance" action in the UI.
 */
export async function setCurrentBalance(amount: number): Promise<void> {
  // Store as an app setting
  await prisma.appSetting.upsert({
    where: { key: 'currentBankBalance' },
    create: { key: 'currentBankBalance', value: String(amount) },
    update: { value: String(amount) },
  });

  // Update the opening balance of the first pay period
  const firstPeriod = await prisma.payPeriod.findFirst({
    where: { paydayDate: { gte: new Date() } },
    orderBy: { paydayDate: 'asc' },
  });

  if (firstPeriod) {
    await prisma.payPeriod.update({
      where: { id: firstPeriod.id },
      data: { openingBalance: amount },
    });

    await prisma.reconciliationLog.create({
      data: {
        resourceType: 'balance',
        resourceId: firstPeriod.id,
        action: 'set_balance',
        newValue: amount,
      },
    });

    const affectedIds = await recomputeFromPeriod(firstPeriod.id);
    broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });
  }
}
