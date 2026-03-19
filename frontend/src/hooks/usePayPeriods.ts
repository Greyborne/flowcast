import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import type { PayPeriod, BillGridData, IncomeGridData } from '../types';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function usePayPeriods() {
  return useQuery<PayPeriod[]>({
    queryKey: ['payPeriods'],
    queryFn: async () => {
      const { data } = await axios.get(`${API}/api/pay-periods`);
      return data;
    },
  });
}

export function useBillGrid() {
  return useQuery<BillGridData>({
    queryKey: ['billGrid'],
    queryFn: async () => {
      const { data } = await axios.get(`${API}/api/bills/grid`);
      return data;
    },
  });
}

export function useIncomeGrid() {
  return useQuery<IncomeGridData>({
    queryKey: ['incomeGrid'],
    queryFn: async () => {
      const { data } = await axios.get(`${API}/api/income/grid`);
      return data;
    },
  });
}

export function useReconcileIncome() {
  return async (incomeEntryId: string, actualAmount: number, notes?: string) => {
    await axios.post(`${API}/api/reconciliation/income/${incomeEntryId}`, {
      actualAmount,
      notes,
    });
  };
}

export function useReconcileBill() {
  return async (billInstanceId: string, actualAmount: number, notes?: string) => {
    await axios.post(`${API}/api/reconciliation/bill/${billInstanceId}`, {
      actualAmount,
      notes,
    });
  };
}

export function useSetBalance() {
  return async (amount: number) => {
    await axios.post(`${API}/api/reconciliation/balance`, { amount });
  };
}
