import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import api from '../lib/api';
import type { Account } from '../types';

// ── Color palette helpers ─────────────────────────────────────────────────────
export const ACCOUNT_COLORS: Record<string, { bg: string; ring: string; text: string; dot: string }> = {
  blue:   { bg: 'bg-blue-600',   ring: 'ring-blue-500',   text: 'text-blue-400',   dot: 'bg-blue-400' },
  green:  { bg: 'bg-green-600',  ring: 'ring-green-500',  text: 'text-green-400',  dot: 'bg-green-400' },
  purple: { bg: 'bg-purple-600', ring: 'ring-purple-500', text: 'text-purple-400', dot: 'bg-purple-400' },
  amber:  { bg: 'bg-amber-500',  ring: 'ring-amber-400',  text: 'text-amber-400',  dot: 'bg-amber-400' },
  rose:   { bg: 'bg-rose-600',   ring: 'ring-rose-500',   text: 'text-rose-400',   dot: 'bg-rose-400' },
  teal:   { bg: 'bg-teal-600',   ring: 'ring-teal-500',   text: 'text-teal-400',   dot: 'bg-teal-400' },
};

// ── Context shape ─────────────────────────────────────────────────────────────
interface AccountContextValue {
  accounts: Account[];
  activeAccount: Account | null;
  isLoading: boolean;
  switchAccount: (id: string) => void;
  createAccount: (payload: CreateAccountPayload) => Promise<Account>;
  updateAccount: (id: string, payload: Partial<Pick<Account, 'name' | 'color'>>) => Promise<void>;
  refetchAccounts: () => Promise<void>;
}

export interface CreateAccountPayload {
  name: string;
  color: string;
  periodType: string;
}

const AccountContext = createContext<AccountContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────
export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string>(
    () => localStorage.getItem('activeAccountId') || 'personal'
  );
  const [isLoading, setIsLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await api.get('/api/accounts');
      setAccounts(data);
      // If stored account no longer exists, fall back to personal
      const ids = (data as Account[]).map((a) => a.id);
      if (!ids.includes(activeAccountId)) {
        setActiveAccountId('personal');
        localStorage.setItem('activeAccountId', 'personal');
      }
    } catch (err) {
      console.error('[AccountContext] Failed to load accounts', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeAccountId]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const switchAccount = useCallback((id: string) => {
    localStorage.setItem('activeAccountId', id);
    setActiveAccountId(id);
    // Force a full page reload so all TanStack Query caches are cleared and
    // re-fetched with the new X-Account-Id header already in place.
    window.location.reload();
  }, []);

  const createAccount = useCallback(async (payload: CreateAccountPayload): Promise<Account> => {
    const { data } = await api.post('/api/accounts', payload);
    await fetchAccounts();
    return data;
  }, [fetchAccounts]);

  const updateAccount = useCallback(async (id: string, payload: Partial<Pick<Account, 'name' | 'color'>>) => {
    await api.put(`/api/accounts/${id}`, payload);
    await fetchAccounts();
  }, [fetchAccounts]);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;

  return (
    <AccountContext.Provider value={{
      accounts,
      activeAccount,
      isLoading,
      switchAccount,
      createAccount,
      updateAccount,
      refetchAccounts: fetchAccounts,
    }}>
      {children}
    </AccountContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used inside <AccountProvider>');
  return ctx;
}
