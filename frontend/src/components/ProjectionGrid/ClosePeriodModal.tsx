import { useState } from 'react';
import { useClosePeriodPreview, useClosePeriod } from '../../hooks/usePayPeriods';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

interface Props {
  periodId: string;
  paydayLabel: string;
  onClose: () => void;
}

export default function ClosePeriodModal({ periodId, paydayLabel, onClose }: Props) {
  const { data: preview, isLoading } = useClosePeriodPreview(periodId);
  const closeMutation = useClosePeriod();

  // discretionary amounts keyed by billTemplateId
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  function setAmount(id: string, val: string) {
    setAmounts((prev) => ({ ...prev, [id]: val }));
  }

  // Live balance preview
  const discretionaryTotal = preview
    ? preview.discretionaryTemplates.reduce((sum, t) => {
        const v = parseFloat(amounts[t.id] ?? '');
        return sum + (isNaN(v) ? 0 : v);
      }, 0)
    : 0;

  const autoIncomeTotal = preview
    ? preview.incomeToReconcile.reduce((s, e) => s + (e.projectedAmount ?? 0), 0)
    : 0;
  const reconciledIncomeTotal = preview
    ? preview.incomeReconciled.reduce((s, e) => s + (e.actualAmount ?? 0), 0)
    : 0;
  const autoFixedTotal = preview
    ? preview.fixedToReconcile.reduce((s, e) => s + (e.projectedAmount ?? 0), 0)
    : 0;
  const reconciledFixedTotal = preview
    ? preview.fixedReconciled.reduce((s, e) => s + (e.actualAmount ?? 0), 0)
    : 0;
  const reconciledDiscTotal = preview
    ? preview.discretionaryReconciled.reduce((s, e) => s + (e.actualAmount ?? 0), 0)
    : 0;

  const closingBalance = preview
    ? preview.openingBalance
      + reconciledIncomeTotal + autoIncomeTotal
      - reconciledFixedTotal - autoFixedTotal
      - reconciledDiscTotal - discretionaryTotal
    : 0;

  async function handleConfirm() {
    const discretionaryAmounts = Object.entries(amounts)
      .map(([billTemplateId, v]) => ({ billTemplateId, amount: parseFloat(v) || 0 }))
      .filter(({ amount }) => amount > 0);

    await closeMutation.mutateAsync({ periodId, discretionaryAmounts });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-base font-bold text-white">Close Pay Period</h3>
            <p className="text-xs text-gray-500 mt-0.5">{paydayLabel}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        {isLoading && (
          <p className="text-sm text-gray-500 text-center py-12">Loading…</p>
        )}

        {preview && (
          <div className="divide-y divide-gray-800">

            {/* Income — auto-reconcile */}
            {(preview.incomeToReconcile.length > 0 || preview.incomeReconciled.length > 0) && (
              <Section title="Income" color="text-green-400">
                {preview.incomeReconciled.map((e) => (
                  <Row key={e.id} name={e.name} amount={e.actualAmount ?? 0} color="text-green-300" tag="reconciled" />
                ))}
                {preview.incomeToReconcile.map((e) => (
                  <Row key={e.id} name={e.name} amount={e.projectedAmount ?? 0} color="text-green-300" tag="auto" />
                ))}
              </Section>
            )}

            {/* Fixed expenses — auto-reconcile at projected */}
            {(preview.fixedToReconcile.length > 0 || preview.fixedReconciled.length > 0) && (
              <Section title="Fixed Expenses" color="text-orange-400">
                {preview.fixedReconciled.map((e) => (
                  <Row key={e.id} name={e.name} amount={e.actualAmount ?? 0} color="text-orange-300" tag="reconciled" />
                ))}
                {preview.fixedToReconcile.map((e) => (
                  <Row key={e.id} name={e.name} amount={e.projectedAmount ?? 0} color="text-orange-300" tag="auto" />
                ))}
              </Section>
            )}

            {/* Discretionary — user enters actual spend */}
            {(preview.discretionaryTemplates.length > 0 || preview.discretionaryReconciled.length > 0) && (
              <Section title="Discretionary Expenses" color="text-yellow-400"
                subtitle="Enter what you actually spent. Leave blank or $0 to skip.">
                {preview.discretionaryReconciled.map((e) => (
                  <Row key={e.id} name={e.name} amount={e.actualAmount ?? 0} color="text-orange-300" tag="reconciled" />
                ))}
                {preview.discretionaryTemplates.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 py-1.5">
                    <span className="flex-1 text-xs text-gray-300 truncate">{t.name}</span>
                    <span className="text-xs text-gray-600">{fmt.format(t.defaultAmount ?? 0)} default</span>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amounts[t.id] ?? ''}
                        onChange={(e) => setAmount(t.id, e.target.value)}
                        placeholder="0.00"
                        className="w-24 bg-gray-800 border border-gray-700 rounded-lg pl-5 pr-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-yellow-500 text-right"
                      />
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {/* Balance summary */}
            <div className="px-5 py-4 space-y-1.5">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Opening balance</span>
                <span className="font-mono">{fmt.format(preview.openingBalance)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Total income</span>
                <span className="font-mono text-green-400">+{fmt.format(reconciledIncomeTotal + autoIncomeTotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Total expenses</span>
                <span className="font-mono text-orange-400">−{fmt.format(reconciledFixedTotal + autoFixedTotal + reconciledDiscTotal + discretionaryTotal)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold border-t border-gray-800 pt-2 mt-2">
                <span className="text-gray-300">Closing balance</span>
                <span className={`font-mono ${closingBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmt.format(closingBalance)}
                </span>
              </div>
              <p className="text-[10px] text-gray-600 pt-1">
                This becomes the opening balance of the next pay period.
              </p>
            </div>

            {/* Actions */}
            <div className="px-5 py-4 flex gap-3">
              <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700">
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={closeMutation.isPending}
                className="flex-1 px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                {closeMutation.isPending ? 'Closing…' : '🔒 Close Period'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, color, subtitle, children }: {
  title: string; color: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3">
      <p className={`text-[10px] font-bold uppercase tracking-widest ${color} mb-1`}>{title}</p>
      {subtitle && <p className="text-[10px] text-gray-500 mb-2">{subtitle}</p>}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ name, amount, color, tag }: {
  name: string; amount: number; color: string; tag: 'auto' | 'reconciled';
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="flex-1 text-xs text-gray-400 truncate">{name}</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${tag === 'reconciled' ? 'bg-gray-700 text-gray-500' : 'bg-blue-900/40 text-blue-400'}`}>
        {tag === 'reconciled' ? '✓ done' : 'auto'}
      </span>
      <span className={`text-xs font-mono ${color}`}>{fmt.format(amount)}</span>
    </div>
  );
}
