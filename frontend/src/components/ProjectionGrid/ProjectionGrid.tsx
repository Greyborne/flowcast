import { useState, Fragment, useRef, useEffect } from 'react';
import axios from 'axios';
import { usePayPeriods, useBillGrid, useIncomeGrid, useCreateAdhocBill } from '../../hooks/usePayPeriods';
import type { PayPeriod, BillTemplate, BillGridInstance, IncomeSource, IncomeGridEntry } from '../../types';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const fmt = (n: number | undefined | null) =>
  n != null
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
    : '—';

const fmtDate = (d: string) =>
  new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: '2-digit',
  });

type ActiveCell = { type: 'income' | 'bill'; id: string; mode: 'reconcile' | 'unreconcile' } | null;
type BillGridData  = { templates: BillTemplate[]; instanceMap: Record<string, Record<string, BillGridInstance>> };
type IncomeGridData = { sources: IncomeSource[]; entryMap: Record<string, Record<string, IncomeGridEntry>> };

// ── thead + projected balance row heights (used for dual-sticky offsets) ──────
const THEAD_H = 'top-0';
const BALANCE_TOP = 'top-[41px]';

export default function ProjectionGrid() {
  const { data: periods,    isLoading: periodsLoading } = usePayPeriods();
  const { data: billGrid,   isLoading: billsLoading   } = useBillGrid();
  const { data: incomeGrid, isLoading: incomeLoading  } = useIncomeGrid();

  const [visibleCount,     setVisibleCount]     = useState(12);
  const [activeCell,       setActiveCell]       = useState<ActiveCell>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const createAdhoc = useCreateAdhocBill();

  if (periodsLoading || billsLoading || incomeLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        <div className="text-center">
          <div className="text-2xl mb-2">⚡</div>
          <div>Computing projections…</div>
        </div>
      </div>
    );
  }

  if (!periods?.length) {
    return (
      <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
        <p className="text-gray-400">No pay periods found.</p>
        <p className="text-gray-600 text-sm mt-1">
          Run <code className="text-blue-400">npm run db:seed</code> to initialize.
        </p>
      </div>
    );
  }

  const visiblePeriods  = periods.slice(0, visibleCount);
  const selectedPeriod  = selectedPeriodId
    ? periods.find((p) => p.id === selectedPeriodId) ?? null
    : null;

  const groups = billGrid
    ? (() => {
        const byGroup = billGrid.templates.reduce<Record<string, BillTemplate[]>>((acc, t) => {
          (acc[t.group] ??= []).push(t);
          return acc;
        }, {});
        // Sort by the persisted billGroups order; unknown groups fall to the end
        const orderMap = Object.fromEntries(billGrid.groups.map((g, i) => [g, i]));
        return Object.entries(byGroup).sort(([a], [b]) =>
          (orderMap[a] ?? 9999) - (orderMap[b] ?? 9999)
        );
      })()
    : [];

  const togglePeriod = (id: string) =>
    setSelectedPeriodId((cur) => (cur === id ? null : id));

  return (
    <div className="relative">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          2-Year Cash Flow Projection
        </h2>
        <span className="text-xs text-gray-600">
          Showing {visibleCount} of {periods.length} pay periods
        </span>
      </div>

      {/* ── Grid ── */}
      <div className="overflow-auto rounded-xl border border-gray-800 max-h-[calc(100vh-260px)]">
        <table className="min-w-full text-sm">

          {/* ── Date header row — sticky top ── */}
          <thead>
            <tr className="bg-gray-900 border-b border-gray-800">
              <th className={`sticky left-0 ${THEAD_H} z-30 bg-gray-900 text-left py-3 px-4 text-xs text-gray-500 uppercase tracking-wider w-48 border-r border-gray-800`}>
                Pay Period
              </th>
              {visiblePeriods.map((p) => (
                <th
                  key={p.id}
                  onClick={() => togglePeriod(p.id)}
                  className={`sticky ${THEAD_H} z-20 py-3 px-4 text-center text-xs whitespace-nowrap min-w-[110px] cursor-pointer transition-colors select-none ${
                    selectedPeriodId === p.id
                      ? 'bg-blue-900 text-blue-300'
                      : 'bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                  }`}
                >
                  {fmtDate(p.paydayDate)}
                  {selectedPeriodId === p.id && (
                    <span className="ml-1 text-blue-400">›</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/* ── Projected Balance — sticky just below header ── */}
            <tr>
              <td style={{ boxShadow: '0 2px 0 #374151' }} className={`sticky left-0 ${BALANCE_TOP} z-20 bg-gray-900 py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider border-r border-gray-800`}>
                Projected Balance
              </td>
              {visiblePeriods.map((p) => {
                const bal   = p.balanceSnapshot?.runningBalance;
                const isNeg = (bal ?? 0) < 0;
                const isSel = selectedPeriodId === p.id;
                return (
                  <td
                    key={p.id}
                    style={{ boxShadow: '0 2px 0 #374151' }}
                    className={`sticky ${BALANCE_TOP} z-10 py-3 px-4 text-center font-bold whitespace-nowrap transition-colors ${
                      isNeg ? 'text-red-400' : 'text-green-400'
                    } ${isSel ? 'bg-blue-900' : 'bg-gray-900'}`}
                  >
                    {fmt(bal)}
                  </td>
                );
              })}
            </tr>

            {/* ── Income rows ── */}
            {incomeGrid && (
              <>
                <tr className="bg-gray-900/60 border-t-2 border-gray-700">
                  <td
                    colSpan={visiblePeriods.length + 1}
                    className="sticky left-0 py-1.5 px-4 text-xs font-bold text-green-400 uppercase tracking-widest"
                  >
                    Income
                  </td>
                </tr>
                {incomeGrid.sources.map((source) => (
                  <IncomeRow
                    key={source.id}
                    source={source}
                    periods={visiblePeriods}
                    entryMap={incomeGrid.entryMap[source.id] ?? {}}
                    activeCell={activeCell}
                    setActiveCell={setActiveCell}
                    selectedPeriodId={selectedPeriodId}
                  />
                ))}
              </>
            )}

            {/* ── Bill rows grouped by category ── */}
            {billGrid && groups.map(([group, templates]) => (
              <Fragment key={group}>
                <tr className="bg-gray-900/60 border-t-2 border-gray-700">
                  <td
                    colSpan={visiblePeriods.length + 1}
                    className="sticky left-0 py-1.5 px-4 text-xs font-bold text-blue-400 uppercase tracking-widest"
                  >
                    {group}
                  </td>
                </tr>
                {templates.map((template) => (
                  <BillRow
                    key={template.id}
                    template={template}
                    periods={visiblePeriods}
                    instanceMap={billGrid.instanceMap[template.id] ?? {}}
                    activeCell={activeCell}
                    setActiveCell={setActiveCell}
                    selectedPeriodId={selectedPeriodId}
                    onCreateAdhoc={(payPeriodId) =>
                      createAdhoc.mutate({ billTemplateId: template.id, payPeriodId })
                    }
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Load more ── */}
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

      {/* ── Period detail panel ── */}
      {selectedPeriod && billGrid && incomeGrid && (
        <>
          {/* Invisible backdrop — click to close */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setSelectedPeriodId(null)}
          />
          <PeriodDetailPanel
            period={selectedPeriod}
            billGrid={billGrid as BillGridData}
            incomeGrid={incomeGrid as IncomeGridData}
            onClose={() => setSelectedPeriodId(null)}
          />
        </>
      )}
    </div>
  );
}

// ── Period detail panel ────────────────────────────────────────────────────────

function PeriodDetailPanel({
  period,
  billGrid,
  incomeGrid,
  onClose,
}: {
  period:     PayPeriod;
  billGrid:   BillGridData;
  incomeGrid: IncomeGridData;
  onClose:    () => void;
}) {
  const projected = period.balanceSnapshot?.runningBalance;
  const planned   = period.balanceSnapshot?.plannedBalance;
  const diff      = (projected ?? 0) - (planned ?? 0);

  const incomeItems = incomeGrid.sources
    .map((s) => ({ source: s, entry: incomeGrid.entryMap[s.id]?.[period.id] }))
    .filter((x): x is { source: IncomeSource; entry: IncomeGridEntry } => x.entry != null);

  const billGroups = Object.entries(
    billGrid.templates
      .filter((t) => billGrid.instanceMap[t.id]?.[period.id])
      .reduce<Record<string, BillTemplate[]>>((acc, t) => {
        (acc[t.group] ??= []).push(t);
        return acc;
      }, {})
  ).sort(([a], [b]) => a.localeCompare(b));

  const totalIncome   = incomeItems.reduce((s, { entry }) => s + (entry.isReconciled ? (entry.actualAmount ?? entry.projectedAmount) : entry.projectedAmount), 0);
  const totalExpenses = billGroups.flatMap(([, ts]) => ts).reduce((s, t) => {
    const inst = billGrid.instanceMap[t.id][period.id];
    return s + (inst.isReconciled ? (inst.actualAmount ?? inst.projectedAmount) : inst.projectedAmount);
  }, 0);

  return (
    <div
      className="fixed right-0 top-0 h-full w-[380px] bg-gray-950 border-l border-gray-700 overflow-y-auto z-50 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950 border-b border-gray-700 px-5 py-4 flex items-start justify-between">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest">Pay Period Detail</p>
          <h2 className="text-white font-bold text-lg leading-tight">{fmtDate(period.paydayDate)}</h2>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white text-xl leading-none mt-1 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Balance comparison */}
      <div className="px-5 py-4 grid grid-cols-2 gap-4 border-b border-gray-800">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Projected</p>
          <p className={`text-2xl font-bold ${(projected ?? 0) < 0 ? 'text-red-400' : 'text-green-400'}`}>
            {fmt(projected)}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Originally Planned</p>
          <p className={`text-xl font-bold opacity-50 ${(planned ?? 0) < 0 ? 'text-red-400' : 'text-green-400'}`}>
            {fmt(planned)}
          </p>
          {diff !== 0 && (
            <p className={`text-xs mt-0.5 ${diff < 0 ? 'text-red-500' : 'text-yellow-400'}`}>
              {diff > 0 ? '+' : ''}{fmt(diff)} vs plan
            </p>
          )}
        </div>
      </div>

      {/* Income / Expense summary */}
      <div className="px-5 py-3 flex gap-6 border-b border-gray-800 bg-gray-900/40">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest">Income</p>
          <p className="text-sm font-semibold text-green-400">{fmt(totalIncome)}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest">Expenses</p>
          <p className="text-sm font-semibold text-orange-400">{fmt(totalExpenses)}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest">Net</p>
          <p className={`text-sm font-semibold ${totalIncome - totalExpenses < 0 ? 'text-red-400' : 'text-green-400'}`}>
            {fmt(totalIncome - totalExpenses)}
          </p>
        </div>
      </div>

      {/* Income detail */}
      {incomeItems.length > 0 && (
        <div className="px-5 py-4 border-b border-gray-800">
          <p className="text-[10px] text-green-400 uppercase tracking-widest font-bold mb-3">Income</p>
          {incomeItems.map(({ source, entry }) => (
            <div key={source.id} className="flex justify-between items-center py-1.5">
              <span className="text-xs text-gray-300">{source.name}</span>
              <div className="text-right">
                {entry.isReconciled ? (
                  <>
                    <span className="text-xs text-gray-600 line-through mr-2">{fmt(entry.projectedAmount)}</span>
                    <span className="text-xs text-green-300 font-medium">{fmt(entry.actualAmount)}</span>
                  </>
                ) : (
                  <span className="text-xs text-green-300/60">{fmt(entry.projectedAmount)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bills by group */}
      {billGroups.map(([group, templates]) => (
        <div key={group} className="px-5 py-4 border-b border-gray-800">
          <p className="text-[10px] text-blue-400 uppercase tracking-widest font-bold mb-3">{group}</p>
          {templates.map((t) => {
            const inst = billGrid.instanceMap[t.id][period.id];
            return (
              <div key={t.id} className="flex justify-between items-center py-1.5">
                <span className="text-xs text-gray-300">{t.name}</span>
                <div className="text-right">
                  {inst.isReconciled ? (
                    <>
                      <span className="text-xs text-gray-600 line-through mr-2">{fmt(inst.projectedAmount)}</span>
                      <span className="text-xs text-orange-300 font-medium">{fmt(inst.actualAmount)}</span>
                    </>
                  ) : (
                    <span className="text-xs text-orange-300/60">{fmt(inst.projectedAmount)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Income row ────────────────────────────────────────────────────────────────

function IncomeRow({
  source, periods, entryMap, activeCell, setActiveCell, selectedPeriodId,
}: {
  source: IncomeSource;
  periods: PayPeriod[];
  entryMap: Record<string, IncomeGridEntry>;
  activeCell: ActiveCell;
  setActiveCell: (c: ActiveCell) => void;
  selectedPeriodId: string | null;
}) {
  return (
    <tr className="border-b border-gray-800/60 hover:bg-gray-900/40">
      <td className="sticky left-0 bg-gray-950 py-2 px-4 text-xs text-gray-300 border-r border-gray-800 z-10 whitespace-nowrap">
        {source.name}
        <span className="ml-1 text-gray-600 text-[10px]">({source.type})</span>
      </td>
      {periods.map((p) => {
        const entry  = entryMap[p.id];
        const isSel  = selectedPeriodId === p.id;
        if (!entry) {
          return (
            <td key={p.id} className={`py-2 px-4 text-center text-gray-800 text-xs ${isSel ? 'bg-blue-950/20' : ''}`}>
              —
            </td>
          );
        }
        const mode = activeCell?.id === entry.id ? activeCell.mode : null;
        return (
          <td key={p.id} className={`py-1 px-2 text-center ${isSel ? 'bg-blue-950/20' : ''}`}>
            {mode === 'reconcile' ? (
              <ReconcileInput
                defaultValue={entry.actualAmount ?? entry.projectedAmount}
                onDraftSave={async (amount, cascade) => {
                  await axios.patch(`${API}/api/income/entry/${entry.id}`, { projectedAmount: amount, cascade });
                  setActiveCell(null);
                }}
                onReconcile={async (amount, cascade) => {
                  await axios.post(`${API}/api/reconciliation/income/${entry.id}`, { actualAmount: amount, cascade });
                  setActiveCell(null);
                }}
                onCancel={() => setActiveCell(null)}
              />
            ) : mode === 'unreconcile' ? (
              <UnreconcileConfirm
                onConfirm={async () => {
                  await axios.delete(`${API}/api/reconciliation/income/${entry.id}`);
                  setActiveCell(null);
                }}
                onCancel={() => setActiveCell(null)}
              />
            ) : (
              <ReconcileCell
                amount={entry.isReconciled ? (entry.actualAmount ?? entry.projectedAmount) : entry.projectedAmount}
                isReconciled={entry.isReconciled}
                colorClass={entry.isReconciled ? 'text-gray-500' : 'text-green-300'}
                onClick={() => setActiveCell({ type: 'income', id: entry.id, mode: entry.isReconciled ? 'unreconcile' : 'reconcile' })}
                title={entry.isReconciled ? 'Click to un-reconcile' : 'Click to reconcile'}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ── Bill row ──────────────────────────────────────────────────────────────────

function BillRow({
  template, periods, instanceMap, activeCell, setActiveCell, selectedPeriodId, onCreateAdhoc,
}: {
  template: BillTemplate;
  periods: PayPeriod[];
  instanceMap: Record<string, BillGridInstance>;
  activeCell: ActiveCell;
  setActiveCell: (c: ActiveCell) => void;
  selectedPeriodId: string | null;
  onCreateAdhoc: (payPeriodId: string) => void;
}) {
  return (
    <tr className="border-b border-gray-800/60 hover:bg-gray-900/40 group/row">
      <td className="sticky left-0 bg-gray-950 py-2 px-4 text-xs text-gray-300 border-r border-gray-800 z-10 whitespace-nowrap">
        {template.name}
        {template.dueDayOfMonth != null && (
          <span className="ml-1 text-gray-600 text-[10px]">({template.dueDayOfMonth}th)</span>
        )}
      </td>
      {periods.map((p) => {
        const inst  = instanceMap[p.id];
        const isSel = selectedPeriodId === p.id;
        if (!inst) {
          return (
            <td key={p.id} className={`py-2 px-4 text-center text-gray-800 text-xs ${isSel ? 'bg-blue-950/20' : ''}`}>
              <button
                onClick={() => onCreateAdhoc(p.id)}
                title={`Add ${template.name} to this period`}
                className="opacity-0 group-hover/row:opacity-100 text-gray-600 hover:text-blue-400 transition-all text-xs leading-none"
              >
                +
              </button>
            </td>
          );
        }
        const mode   = activeCell?.id === inst.id ? activeCell.mode : null;
        const amount = inst.isReconciled ? (inst.actualAmount ?? inst.projectedAmount) : inst.projectedAmount;
        return (
          <td key={p.id} className={`py-1 px-2 text-center ${isSel ? 'bg-blue-950/20' : ''}`}>
            {mode === 'reconcile' ? (
              <ReconcileInput
                defaultValue={inst.actualAmount ?? inst.projectedAmount}
                onDraftSave={async (val, cascade) => {
                  await axios.patch(`${API}/api/bills/instance/${inst.id}`, { projectedAmount: val, cascade });
                  setActiveCell(null);
                }}
                onReconcile={async (val, cascade) => {
                  await axios.post(`${API}/api/reconciliation/bill/${inst.id}`, { actualAmount: val, cascade });
                  setActiveCell(null);
                }}
                onCancel={() => setActiveCell(null)}
              />
            ) : mode === 'unreconcile' ? (
              <UnreconcileConfirm
                onConfirm={async () => {
                  await axios.delete(`${API}/api/reconciliation/bill/${inst.id}`);
                  setActiveCell(null);
                }}
                onCancel={() => setActiveCell(null)}
              />
            ) : (
              <ReconcileCell
                amount={amount}
                isReconciled={inst.isReconciled}
                colorClass={inst.isReconciled ? 'text-gray-500' : amount > 0 ? 'text-orange-300' : 'text-gray-600'}
                onClick={() => setActiveCell({ type: 'bill', id: inst.id, mode: inst.isFrozen ? 'unreconcile' : 'reconcile' })}
                title={inst.isFrozen ? 'Click to un-reconcile' : 'Click to reconcile'}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ── Shared cell primitives ────────────────────────────────────────────────────

function ReconcileCell({
  amount, isReconciled, colorClass, onClick, title,
}: {
  amount: number;
  isReconciled: boolean;
  colorClass: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-full text-xs whitespace-nowrap px-1 py-1 rounded hover:bg-gray-800 transition-colors ${colorClass} ${
        isReconciled ? 'line-through cursor-default' : 'cursor-pointer'
      }`}
    >
      {amount > 0 ? fmt(amount) : '—'}
    </button>
  );
}

function UnreconcileConfirm({
  onConfirm, onCancel,
}: {
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(false);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] text-yellow-400 whitespace-nowrap">Un-reconcile?</span>
      <div className="flex gap-1">
        <button
          onClick={async () => { setLoading(true); await onConfirm(); setLoading(false); }}
          disabled={loading}
          className="text-[10px] bg-yellow-700 hover:bg-yellow-600 text-white px-1.5 py-0.5 rounded disabled:opacity-50"
        >
          {loading ? '…' : '✓'}
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          className="text-[10px] bg-gray-700 hover:bg-gray-600 text-white px-1.5 py-0.5 rounded"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function ReconcileInput({
  defaultValue, onDraftSave, onReconcile, onCancel,
}: {
  defaultValue: number;
  onDraftSave: (amount: number, cascade: boolean) => Promise<void>;
  onReconcile: (amount: number, cascade: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [value,   setValue]   = useState(String(defaultValue));
  const [cascade, setCascade] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const run = async (fn: (amount: number, cascade: boolean) => Promise<void>) => {
    const amount = parseFloat(value);
    if (isNaN(amount)) return;
    setSaving(true);
    try { await fn(amount, cascade); } finally { setSaving(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); run(onDraftSave); }
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={saving}
        className="w-20 bg-gray-800 border border-blue-500 text-white text-xs rounded px-1 py-0.5 text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <div className="flex gap-1 items-center">
        <button
          onClick={() => run(onReconcile)}
          disabled={saving}
          title="Save & reconcile (freeze)"
          className="text-[10px] bg-green-700 hover:bg-green-600 text-white px-1.5 py-0.5 rounded disabled:opacity-50"
        >
          {saving ? '…' : '✓'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="text-[10px] bg-gray-700 hover:bg-gray-600 text-white px-1.5 py-0.5 rounded"
        >
          ✕
        </button>
        <button
          onClick={() => setCascade((c) => !c)}
          className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-colors whitespace-nowrap ${
            cascade
              ? 'border-blue-600 text-blue-400 bg-blue-950'
              : 'border-gray-600 text-gray-500 bg-transparent'
          }`}
        >
          {cascade ? 'All future' : 'This only'}
        </button>
      </div>
    </div>
  );
}
