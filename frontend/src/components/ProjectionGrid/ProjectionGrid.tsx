import { useState } from 'react';
import { usePayPeriods } from '../../hooks/usePayPeriods';
import type { PayPeriod } from '../../types';

const fmt = (n: number | undefined | null) =>
  n != null
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
    : '—';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

export default function ProjectionGrid() {
  const { data: periods, isLoading } = usePayPeriods();
  const [visibleCount, setVisibleCount] = useState(12); // Show 12 periods (~6 months) initially

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        <div className="text-center">
          <div className="text-2xl mb-2">⚡</div>
          <div>Computing projections...</div>
        </div>
      </div>
    );
  }

  if (!periods?.length) {
    return (
      <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
        <p className="text-gray-400">No pay periods found.</p>
        <p className="text-gray-600 text-sm mt-1">Run <code className="text-blue-400">npm run db:seed</code> to initialize.</p>
      </div>
    );
  }

  const visiblePeriods = periods.slice(0, visibleCount);

  return (
    <div>
      {/* Grid header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          2-Year Cash Flow Projection
        </h2>
        <span className="text-xs text-gray-600">
          Showing {visibleCount} of {periods.length} pay periods
        </span>
      </div>

      {/* Horizontal scrollable grid */}
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-900 border-b border-gray-800">
              <th className="sticky left-0 bg-gray-900 text-left py-3 px-4 text-xs text-gray-500 uppercase tracking-wider w-40 z-10 border-r border-gray-800">
                Pay Period
              </th>
              {visiblePeriods.map((p) => (
                <th
                  key={p.id}
                  className="py-3 px-4 text-center text-xs text-gray-400 whitespace-nowrap min-w-[120px]"
                >
                  {fmtDate(p.paydayDate)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/* Planned Balance row */}
            <BalanceRow label="Planned Balance" periods={visiblePeriods} type="planned" />
            {/* Running Balance row */}
            <BalanceRow label="Running Balance" periods={visiblePeriods} type="running" />
            {/* Difference row */}
            <DifferenceRow periods={visiblePeriods} />
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {visibleCount < periods.length && (
        <div className="mt-4 text-center">
          <button
            onClick={() => setVisibleCount((c) => Math.min(c + 13, periods.length))}
            className="text-sm text-blue-400 hover:text-blue-300 border border-gray-700 hover:border-gray-600 px-4 py-2 rounded-lg transition-colors"
          >
            Load next 6 months →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BalanceRow({
  label,
  periods,
  type,
}: {
  label: string;
  periods: PayPeriod[];
  type: 'planned' | 'running';
}) {
  return (
    <tr className="border-b border-gray-800 hover:bg-gray-900/50">
      <td className="sticky left-0 bg-gray-950 py-3 px-4 text-xs font-semibold text-gray-400 uppercase border-r border-gray-800 z-10">
        {label}
      </td>
      {periods.map((p) => {
        const balance =
          type === 'planned'
            ? p.balanceSnapshot?.plannedBalance
            : p.balanceSnapshot?.runningBalance;
        const isNegative = (balance ?? 0) < 0;
        return (
          <td
            key={p.id}
            className={`py-3 px-4 text-center font-bold whitespace-nowrap ${
              isNegative ? 'text-red-400' : 'text-green-400'
            }`}
          >
            {fmt(balance)}
          </td>
        );
      })}
    </tr>
  );
}

function DifferenceRow({ periods }: { periods: PayPeriod[] }) {
  return (
    <tr className="border-b-2 border-gray-700 bg-gray-900/30">
      <td className="sticky left-0 bg-gray-900 py-2 px-4 text-xs text-gray-600 uppercase border-r border-gray-800 z-10">
        Difference
      </td>
      {periods.map((p) => {
        const planned = p.balanceSnapshot?.plannedBalance ?? 0;
        const running = p.balanceSnapshot?.runningBalance ?? 0;
        const diff = planned - running;
        return (
          <td
            key={p.id}
            className={`py-2 px-4 text-center text-xs whitespace-nowrap ${
              diff < 0 ? 'text-red-500' : diff > 0 ? 'text-yellow-500' : 'text-gray-600'
            }`}
          >
            {diff !== 0 ? fmt(diff) : '—'}
          </td>
        );
      })}
    </tr>
  );
}
