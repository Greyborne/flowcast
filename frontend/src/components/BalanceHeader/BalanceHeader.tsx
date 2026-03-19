import { useState } from 'react';
import { usePayPeriods, useSetBalance } from '../../hooks/usePayPeriods';
import { useQueryClient } from '@tanstack/react-query';

export default function BalanceHeader() {
  const { data: periods } = usePayPeriods();
  const setBalance = useSetBalance();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const currentPeriod = periods?.find(
    (p) => new Date(p.paydayDate) >= new Date()
  );
  const snapshot = currentPeriod?.balanceSnapshot;

  const handleSetBalance = async () => {
    const amount = parseFloat(inputValue);
    if (!isNaN(amount)) {
      await setBalance(amount);
      queryClient.invalidateQueries({ queryKey: ['payPeriods'] });
      setEditing(false);
    }
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {/* Current Balance */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Current Balance</p>
        {editing ? (
          <div className="flex gap-2 mt-1">
            <input
              type="number"
              step="0.01"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="bg-gray-800 text-white rounded px-2 py-1 text-sm w-28 border border-blue-500 focus:outline-none"
              autoFocus
            />
            <button
              onClick={handleSetBalance}
              className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded"
            >
              Set
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-gray-400 hover:text-white px-2 py-1"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setEditing(true); setInputValue(''); }}
            className="text-2xl font-bold text-white hover:text-blue-400 transition-colors text-left"
            title="Click to update current balance"
          >
            {snapshot ? fmt(snapshot.runningBalance) : '—'}
          </button>
        )}
        <p className="text-xs text-gray-600 mt-1">Click to update</p>
      </div>

      {/* Next Payday Planned Balance */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Next Payday Balance</p>
        <p className={`text-2xl font-bold ${
          (snapshot?.plannedBalance ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
        }`}>
          {snapshot ? fmt(snapshot.plannedBalance) : '—'}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {currentPeriod
            ? new Date(currentPeriod.paydayDate.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '—'}
        </p>
      </div>

      {/* Total Income This Period */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Income This Period</p>
        <p className="text-2xl font-bold text-green-400">
          {snapshot ? fmt(snapshot.totalIncome) : '—'}
        </p>
      </div>

      {/* Total Expenses This Period */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Expenses This Period</p>
        <p className="text-2xl font-bold text-red-400">
          {snapshot ? fmt(snapshot.totalExpenses) : '—'}
        </p>
      </div>
    </div>
  );
}
