import { useState, useRef, useEffect } from 'react';
import { useAccount, ACCOUNT_COLORS } from '../../context/AccountContext';
import type { Account } from '../../types';

interface AccountSwitcherProps {
  onCreateNew: () => void;
}

export default function AccountSwitcher({ onCreateNew }: AccountSwitcherProps) {
  const { accounts, activeAccount, switchAccount } = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!activeAccount) return null;

  const colors = ACCOUNT_COLORS[activeAccount.color] ?? ACCOUNT_COLORS.blue;

  return (
    <div ref={ref} className="relative">
      {/* ── Trigger ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors text-sm"
      >
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors.dot}`} />
        <span className="text-gray-200 font-medium max-w-[140px] truncate">{activeAccount.name}</span>
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
            Accounts
          </div>

          {accounts.map((account: Account) => {
            const c = ACCOUNT_COLORS[account.color] ?? ACCOUNT_COLORS.blue;
            const isActive = account.id === activeAccount.id;
            return (
              <button
                key={account.id}
                onClick={() => {
                  setOpen(false);
                  if (!isActive) switchAccount(account.id);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors text-left ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.dot}`} />
                <span className="flex-1 truncate">{account.name}</span>
                {isActive && (
                  <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}

          <div className="border-t border-gray-800">
            <button
              onClick={() => { setOpen(false); onCreateNew(); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-blue-400 hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Account
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
