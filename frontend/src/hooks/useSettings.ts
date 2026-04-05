import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';


export interface AppSettings {
  currentBankBalance: string;
  payScheduleAnchor: string;
  payFrequency: string;
  projectionYears: string;
}

export function useSettings() {
  return useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data } = await api.get(`/api/settings`);
      return data;
    },
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<AppSettings>) => {
      await api.put(`/api/settings`, settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

export function useRegeneratePeriods() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/api/settings/regenerate-periods`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payPeriods'] });
      queryClient.invalidateQueries({ queryKey: ['billGrid'] });
      queryClient.invalidateQueries({ queryKey: ['incomeGrid'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
