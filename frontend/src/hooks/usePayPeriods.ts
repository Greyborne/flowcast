import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { PayPeriod, BillGridData, IncomeGridData } from '../types';


export function usePayPeriods() {
  return useQuery<PayPeriod[]>({
    queryKey: ['payPeriods'],
    queryFn: async () => {
      const { data } = await api.get(`/api/pay-periods`);
      return data;
    },
  });
}

export function useBillGrid() {
  return useQuery<BillGridData>({
    queryKey: ['billGrid'],
    queryFn: async () => {
      const { data } = await api.get(`/api/bills/grid`);
      return data;
    },
  });
}

export function useIncomeGrid() {
  return useQuery<IncomeGridData>({
    queryKey: ['incomeGrid'],
    queryFn: async () => {
      const { data } = await api.get(`/api/income/grid`);
      return data;
    },
  });
}

export function useCreateAdhocBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ billTemplateId, payPeriodId, projectedAmount }: {
      billTemplateId: string;
      payPeriodId: string;
      projectedAmount?: number;
    }) => {
      const { data } = await api.post(`/api/bills/adhoc`, { billTemplateId, payPeriodId, projectedAmount });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billGrid'] });
      qc.invalidateQueries({ queryKey: ['payPeriods'] });
    },
  });
}

export function useReconcileIncome() {
  return async (incomeEntryId: string, actualAmount: number, notes?: string) => {
    await api.post(`/api/reconciliation/income/${incomeEntryId}`, {
      actualAmount,
      notes,
    });
  };
}

export function useReconcileBill() {
  return async (billInstanceId: string, actualAmount: number, notes?: string) => {
    await api.post(`/api/reconciliation/bill/${billInstanceId}`, {
      actualAmount,
      notes,
    });
  };
}

export function useSetBalance() {
  return async (amount: number) => {
    await api.post(`/api/reconciliation/balance`, { amount });
  };
}

// ── Close Period Preview ───────────────────────────────────────────────────────

export interface ClosePreviewItem { id: string; name: string; projectedAmount?: number; actualAmount?: number | null; group?: string; isReconciled?: boolean; defaultAmount?: number; }

export interface ClosePeriodPreview {
  isClosed: boolean;
  openingBalance: number;
  runningBalance: number;
  incomeToReconcile: ClosePreviewItem[];
  incomeReconciled: ClosePreviewItem[];
  fixedToReconcile: ClosePreviewItem[];
  fixedReconciled: ClosePreviewItem[];
  discretionaryTemplates: ClosePreviewItem[];
  discretionaryReconciled: ClosePreviewItem[];
}

export function useClosePeriodPreview(periodId: string | null) {
  return useQuery<ClosePeriodPreview>({
    queryKey: ['closePeriodPreview', periodId],
    queryFn: async () => {
      const { data } = await api.get(`/api/pay-periods/${periodId}/close-preview`);
      return data;
    },
    enabled: !!periodId,
  });
}

export function useClosePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ periodId, discretionaryAmounts }: {
      periodId: string;
      discretionaryAmounts: { billTemplateId: string; amount: number }[];
    }) => {
      const { data } = await api.post(`/api/pay-periods/${periodId}/close`, { discretionaryAmounts });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payPeriods'] });
      qc.invalidateQueries({ queryKey: ['billGrid'] });
      qc.invalidateQueries({ queryKey: ['incomeGrid'] });
      qc.invalidateQueries({ queryKey: ['closePeriodPreview'] });
    },
  });
}

export interface ReopenResult {
  success?: boolean;
  requiresCascade?: boolean;
  laterClosedPeriods?: { id: string; paydayDate: string }[];
}

export function useReopenPeriod() {
  const qc = useQueryClient();
  return useMutation<ReopenResult, Error, { periodId: string; cascade?: boolean }>({
    mutationFn: async ({ periodId, cascade = false }) => {
      const { data } = await api.post(`/api/pay-periods/${periodId}/reopen`, { cascade });
      return data as ReopenResult;
    },
    onSuccess: (data) => {
      if (data.success) {
        qc.invalidateQueries({ queryKey: ['payPeriods'] });
        qc.invalidateQueries({ queryKey: ['billGrid'] });
        qc.invalidateQueries({ queryKey: ['incomeGrid'] });
      }
    },
  });
}

export function useMoveInstance() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean; movedToPeriodId: string }, Error, { periodId: string; billInstanceId: string }>({
    mutationFn: async ({ periodId, billInstanceId }) => {
      const { data } = await api.post(`/api/pay-periods/${periodId}/move-instance`, { billInstanceId });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billGrid'] });
      qc.invalidateQueries({ queryKey: ['payPeriods'] });
    },
  });
}
