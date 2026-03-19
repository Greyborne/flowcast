import { Router, Request, Response } from 'express';
import {
  reconcileIncome,
  unreconcileIncome,
  reconcileBill,
  unreconcileBill,
  setCurrentBalance,
} from '../services/cascadeService';

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

// POST /api/reconciliation/balance — set current bank balance (seeds entire projection)
router.post('/balance', async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;
    if (typeof amount !== 'number') {
      return res.status(400).json({ error: 'amount (number) is required' });
    }
    await setCurrentBalance(amount);
    res.json({ success: true, message: 'Current balance updated and projection recomputed' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to set balance' });
  }
});

export default router;
