import { Router, Request, Response } from 'express';
import {
  reconcileIncome,
  unreconcileIncome,
  reconcileBill,
  unreconcileBill,
  setCurrentBalance,
} from '../services/cascadeService';
import prisma from '../models/prisma';
import { recomputeFromPeriod } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';

const router = Router();

// POST /api/reconciliation/income/:id — reconcile an income entry
router.post('/income/:id', async (req: Request, res: Response) => {
  try {
    const { actualAmount, notes, cascade } = req.body;
    if (typeof actualAmount !== 'number') {
      return res.status(400).json({ error: 'actualAmount (number) is required' });
    }
    await reconcileIncome({ incomeEntryId: req.params.id, actualAmount, notes, cascade });
    res.json({ success: true, message: 'Income reconciled and cascade complete' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Reconciliation failed' });
  }
});

// DELETE /api/reconciliation/income/:id — un-reconcile an income entry
router.delete('/income/:id', async (req: Request, res: Response) => {
  try {
    await unreconcileIncome(req.params.id);
    res.json({ success: true, message: 'Income un-reconciled' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Un-reconcile failed' });
  }
});

// POST /api/reconciliation/bill/:id — reconcile a bill instance
router.post('/bill/:id', async (req: Request, res: Response) => {
  try {
    const { actualAmount, notes, cascade } = req.body;
    if (typeof actualAmount !== 'number') {
      return res.status(400).json({ error: 'actualAmount (number) is required' });
    }
    await reconcileBill({ billInstanceId: req.params.id, actualAmount, notes, cascade });
    res.json({ success: true, message: 'Bill reconciled and frozen' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Reconciliation failed' });
  }
});

// DELETE /api/reconciliation/bill/:id — un-reconcile a bill instance
router.delete('/bill/:id', async (req: Request, res: Response) => {
  try {
    await unreconcileBill(req.params.id);
    res.json({ success: true, message: 'Bill un-reconciled and unfrozen' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Un-reconcile failed' });
  }
});

// POST /api/reconciliation/period/:id/batch — reconcile selected items at projected amounts
// Body: { billInstanceIds?: string[], incomeEntryIds?: string[] }
// If arrays omitted, reconciles all unreconciled items in the period.
router.post('/period/:id/batch', async (req: Request, res: Response) => {
  try {
    const payPeriodId = req.params.id;
    await prisma.payPeriod.findUniqueOrThrow({ where: { id: payPeriodId } });

    const { billInstanceIds, incomeEntryIds } = req.body as {
      billInstanceIds?: string[];
      incomeEntryIds?: string[];
    };

    const [bills, entries] = await Promise.all([
      prisma.billInstance.findMany({
        where: {
          payPeriodId,
          isReconciled: false,
          isFrozen: false,
          ...(billInstanceIds ? { id: { in: billInstanceIds } } : {}),
        },
      }),
      prisma.incomeEntry.findMany({
        where: {
          payPeriodId,
          isReconciled: false,
          ...(incomeEntryIds ? { id: { in: incomeEntryIds } } : {}),
        },
      }),
    ]);

    const now = new Date();

    for (const bill of bills) {
      await prisma.billInstance.update({
        where: { id: bill.id },
        data: { actualAmount: bill.projectedAmount, isReconciled: true, isFrozen: true, reconciledAt: now },
      });
      await prisma.reconciliationLog.create({
        data: { accountId: req.accountId, resourceType: 'bill', resourceId: bill.id, action: 'reconcile_batch',
          previousValue: bill.projectedAmount, newValue: bill.projectedAmount, periodsAffected: 1 },
      });
    }

    for (const entry of entries) {
      await prisma.incomeEntry.update({
        where: { id: entry.id },
        data: { actualAmount: entry.projectedAmount, isReconciled: true, reconciledAt: now },
      });
      await prisma.reconciliationLog.create({
        data: { accountId: req.accountId, resourceType: 'income', resourceId: entry.id, action: 'reconcile_batch',
          previousValue: entry.projectedAmount, newValue: entry.projectedAmount, periodsAffected: 1 },
      });
    }

    const affectedIds = await recomputeFromPeriod(payPeriodId);
    broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affectedIds });

    res.json({ success: true, billsReconciled: bills.length, incomeReconciled: entries.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reconciliation/balance — set current bank balance (seeds entire projection)
router.post('/balance', async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;
    if (typeof amount !== 'number') {
      return res.status(400).json({ error: 'amount (number) is required' });
    }
    await setCurrentBalance(amount, req.accountId);
    res.json({ success: true, message: 'Current balance updated and projection recomputed' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to set balance' });
  }
});

export default router;
