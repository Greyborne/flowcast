import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';


// ── Bill Templates ────────────────────────────────────────────────────────────

export interface MonthlyAmountOverride {
  id: string;
  year: number;
  month: number;
  amount: number;
}

export interface BillTemplateForm {
  name: string;
  group: string;
  dueDayOfMonth: number | null;
  defaultAmount: number;
  isDiscretionary: boolean;
  sortOrder: number;
  isActive: boolean;
  notes?: string;
}

export function useBillTemplates() {
  return useQuery({
    queryKey: ['billTemplates'],
    queryFn: async () => {
      const { data } = await api.get(`/api/bills`);
      return data as (BillTemplateForm & { id: string; billType: string })[];
    },
  });
}

export function useCreateBillTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: BillTemplateForm) => {
      const { data } = await api.post(`/api/bills`, { ...form, billType: 'EXPENSE' });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billTemplates'] });
      qc.invalidateQueries({ queryKey: ['billGrid'] });
    },
  });
}

export function useUpdateBillTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id: string; form: Partial<BillTemplateForm> }) => {
      const { data } = await api.put(`/api/bills/${id}`, form);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billTemplates'] });
      qc.invalidateQueries({ queryKey: ['billGrid'] });
    },
  });
}

export function useArchiveBillTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, restore }: { id: string; restore?: boolean }) => {
      const action = restore ? 'restore' : 'archive';
      const { data } = await api.patch(`/api/bills/${id}/${action}`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billTemplates'] });
      qc.invalidateQueries({ queryKey: ['billGrid'] });
    },
  });
}

export function useSetMonthlyAmount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, year, month, amount }: { templateId: string; year: number; month: number; amount: number }) => {
      const { data } = await api.put(`/api/bills/${templateId}/monthly/${year}/${month}`, { amount });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billTemplates'] }),
  });
}

export function useDeleteMonthlyAmount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, year, month }: { templateId: string; year: number; month: number }) => {
      await api.delete(`/api/bills/${templateId}/monthly/${year}/${month}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billTemplates'] }),
  });
}

// ── Bill Groups ───────────────────────────────────────────────────────────────

export function useBillGroups() {
  return useQuery<string[]>({
    queryKey: ['billGroups'],
    queryFn: async () => {
      const { data } = await api.get(`/api/bills/groups`);
      return data;
    },
  });
}

export function useCreateBillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, positionAfterId }: { name: string; positionAfterId: string | null }) => {
      const { data } = await api.post(`/api/bills/groups`, { name, positionAfterId });
      return data as string[];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billGroups'] }),
  });
}

export function useRenameBillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ oldName, newName, positionAfterId }: { oldName: string; newName: string; positionAfterId: string | null }) => {
      const { data } = await api.patch(`/api/bills/groups/rename`, { oldName, newName, positionAfterId });
      return data as string[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billGroups'] });
      qc.invalidateQueries({ queryKey: ['billTemplates'] });
    },
  });
}

export function useDeleteBillGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await api.delete(`/api/bills/groups/${encodeURIComponent(name)}`);
      return data as string[];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billGroups'] }),
  });
}

// ── Income Sources ────────────────────────────────────────────────────────────

export interface IncomeSourceForm {
  name: string;
  type: string;
  defaultAmount: number;
  propagateOnReconcile: boolean;
  isActive: boolean;
  notes?: string;
  startDate?: string;
  dayOfMonth?: number | null;
  expectedDayOfMonth?: number | null;
  sortOrder?: number;
  positionAfterId?: string | null;
  cascadeDefault?: boolean;
}

export function useIncomeSources() {
  return useQuery({
    queryKey: ['incomeSources'],
    queryFn: async () => {
      const { data } = await api.get(`/api/income`);
      return data as (IncomeSourceForm & { id: string })[];
    },
  });
}

export function useCreateIncomeSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: IncomeSourceForm) => {
      const { data } = await api.post(`/api/income`, {
        ...form,
        startDate: form.startDate ? new Date(form.startDate) : new Date(),
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incomeSources'] });
      qc.invalidateQueries({ queryKey: ['incomeGrid'] });
    },
  });
}

export function useUpdateIncomeSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id: string; form: Partial<IncomeSourceForm> }) => {
      const { data } = await api.put(`/api/income/${id}`, form);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incomeSources'] });
      qc.invalidateQueries({ queryKey: ['incomeGrid'] });
    },
  });
}

export function useArchiveIncomeSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, restore }: { id: string; restore?: boolean }) => {
      const action = restore ? 'restore' : 'archive';
      const { data } = await api.patch(`/api/income/${id}/${action}`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incomeSources'] });
      qc.invalidateQueries({ queryKey: ['incomeGrid'] });
    },
  });
}
