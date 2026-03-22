import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import type { Transaction, ImportBatch, AutoMatchRule, ImportResult, MatchCandidate } from '../types';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Transactions ──────────────────────────────────────────────────────────────

export interface TransactionFilters {
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function useTransactions(filters: TransactionFilters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  return useQuery<{ total: number; transactions: Transaction[] }>({
    queryKey: ['transactions', filters],
    queryFn: async () => {
      const { data } = await axios.get(`${API}/api/transactions?${params}`);
      return data;
    },
  });
}

export function useMatchCandidates(transactionId: string | null, search?: string) {
  return useQuery<MatchCandidate[]>({
    queryKey: ['matchCandidates', transactionId, search],
    queryFn: async () => {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const { data } = await axios.get(`${API}/api/transactions/${transactionId}/candidates${params}`);
      return data;
    },
    enabled: !!transactionId,
  });
}

export function useImportTransactions() {
  const qc = useQueryClient();
  return useMutation<ImportResult, Error, File>({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const { data } = await axios.post(`${API}/api/transactions/import`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data as ImportResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['importBatches'] });
    },
  });
}

export function useMatchTransaction() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; billInstanceId?: string; billTemplateId?: string; incomeEntryId?: string; incomeSourceId?: string }>({
    mutationFn: async ({ id, billInstanceId, billTemplateId, incomeEntryId, incomeSourceId }) => {
      await axios.patch(`${API}/api/transactions/${id}/match`, { billInstanceId, billTemplateId, incomeEntryId, incomeSourceId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['matchCandidates'] });
      qc.invalidateQueries({ queryKey: ['billGrid'] });
      qc.invalidateQueries({ queryKey: ['incomeGrid'] });
    },
  });
}

export function useUnmatchTransaction() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id: string) => {
      await axios.patch(`${API}/api/transactions/${id}/unmatch`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['billGrid'] });
      qc.invalidateQueries({ queryKey: ['incomeGrid'] });
    },
  });
}

export function useIgnoreTransaction() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; ignore: boolean }>({
    mutationFn: async ({ id, ignore }) => {
      await axios.patch(`${API}/api/transactions/${id}/${ignore ? 'ignore' : 'unignore'}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });
}

export function useCreateManualTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { date: string; amount: number; description: string; memo?: string; notes?: string }) => {
      const { data } = await axios.post(`${API}/api/transactions/manual`, payload);
      return data as Transaction;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id: string) => {
      await axios.delete(`${API}/api/transactions/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['billGrid'] });
      qc.invalidateQueries({ queryKey: ['incomeGrid'] });
    },
  });
}

// ── Import Batches ────────────────────────────────────────────────────────────

export function useImportBatches() {
  return useQuery<ImportBatch[]>({
    queryKey: ['importBatches'],
    queryFn: async () => {
      const { data } = await axios.get(`${API}/api/transactions/batches`);
      return data;
    },
  });
}

export function useDeleteImportBatch() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id: string) => {
      await axios.delete(`${API}/api/transactions/batches/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['importBatches'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['billGrid'] });
      qc.invalidateQueries({ queryKey: ['incomeGrid'] });
    },
  });
}

// ── Auto Match Rules ──────────────────────────────────────────────────────────

export function useAutoMatchRules() {
  return useQuery<AutoMatchRule[]>({
    queryKey: ['autoMatchRules'],
    queryFn: async () => {
      const { data } = await axios.get(`${API}/api/transactions/rules`);
      return data;
    },
  });
}

export function useCreateAutoMatchRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: Omit<AutoMatchRule, 'id' | 'isActive' | 'createdAt' | 'updatedAt'> & { isActive?: boolean }) => {
      const { data } = await axios.post(`${API}/api/transactions/rules`, rule);
      return data as AutoMatchRule;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['autoMatchRules'] }),
  });
}

export function useUpdateAutoMatchRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<AutoMatchRule> & { id: string }) => {
      const { data } = await axios.put(`${API}/api/transactions/rules/${id}`, updates);
      return data as AutoMatchRule;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['autoMatchRules'] }),
  });
}

export function useDeleteAutoMatchRule() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id: string) => {
      await axios.delete(`${API}/api/transactions/rules/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['autoMatchRules'] }),
  });
}

export function useApplyAutoMatchRules() {
  const qc = useQueryClient();
  return useMutation<{ total: number; matched: number }, Error>({
    mutationFn: async () => {
      const { data } = await axios.post(`${API}/api/transactions/rules/apply`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['importBatches'] });
    },
  });
}
