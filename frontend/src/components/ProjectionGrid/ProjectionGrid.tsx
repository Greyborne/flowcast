import { useState, Fragment, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePayPeriods, useBillGrid, useIncomeGrid, useCreateAdhocBill, useReopenPeriod, useMoveInstance } from '../../hooks/usePayPeriods';
import type { ReopenResult } from '../../hooks/usePayPeriods';
import type { PayPeriod, BillTemplate, BillGridInstance, IncomeSource, IncomeGridEntry } from '../../types';
import { useAccount } from '../../context/AccountContext';
import ClosePeriodModal from './ClosePeriodModal';
import api from '../../lib/api';

const fmt = (n: number | undefined | null) =>
  n != null
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
    : '—';

const fmtDate = (d: string) =>
  new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: '2-digit',
  });

type ActiveCell = { type: 'income' | 'bill'; id: string; mode: 'reconcile' | 'unreconcile' } | null;
type BillGridData  = { templates: BillTemplate[]; instanceMap: Record<string, Record<string, BillGridInstance>>; groups: string[] };
type IncomeGridData = { sources: IncomeSource[]; entryMap: Record<string, Record<string, IncomeGridEntry>> };

// ── thead + projected balance row heights (used for dual-sticky offsets) ──────
const THEAD_H = 'top-0';
const BALANCE_TOP = 'top-[41px]';

export default function ProjectionGrid() {
  const { data: periods,    isLoading: periodsLoading } = usePayPeriods();
  const { data: billGrid,   isLoading: billsLoading   } = useBillGrid();
  const { data: incomeGrid, isLoading: incomeLoading  } = useIncomeGrid();

  const [activeCell,       setActiveCell]       = useState<ActiveCell>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const createAdhoc = useCreateAdhocBill();
  const { activeAccount } = useAccount();
  const isMonthly = activeAccount?.periodType === 'monthly';

  // For monthly accounts show "Mar 2026"; for biweekly show the payday date
  const periodLabel = (p: PayPeriod) =>
    isMonthly
      ? new Date(p.paydayDate.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : fmtDate(p.paydayDate);

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

  const visiblePeriods  = periods; // show all periods — no pagination
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
    <div className="h-full flex flex-col">
      {/* ── Toolbar ── */}
      <div className="shrink-0 flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          2-Year Cash Flow Projection
        </h2>
        <span className="text-xs text-gray-600">
          {periods.length} pay periods
        </span>
      </div>

      {/* ── Grid ── */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-gray-800">
        <table className="w-auto text-sm">

          {/* ── Date header row — sticky top ── */}
          <thead>
            <tr className="bg-gray-900 border-b border-gray-800">
              <th className={`sticky left-0 ${THEAD_H} z-30 bg-gray-900 text-left py-3 px-4 text-xs text-gray-500 uppercase tracking-wider w-48 border-r border-gray-800`}>
                Pay Period
              </th>
              {visiblePeriods.map((p) => {
                const isNegative = (p.balanceSnapshot?.runningBalance ?? 0) < 0;
                const isSel = selectedPeriodId === p.id;
                return (
                  <th
                    key={p.id}
                    onClick={() => togglePeriod(p.id)}
                    className={`sticky ${THEAD_H} z-20 py-3 px-4 text-center text-xs whitespace-nowrap cursor-pointer transition-colors select-none border-b-2 ${
                      isSel
                        ? 'bg-blue-900 text-blue-300 border-blue-500'
                        : isNegative
                          ? 'bg-red-950/40 text-red-400 border-red-700 hover:bg-red-950/60'
                          : 'bg-gray-900 text-gray-400 border-transparent hover:bg-gray-800 hover:text-gray-200'
                    }`}
                  >
                    {periodLabel(p)}
                    {p.isClosed && <span className="ml-1 opacity-60">🔒</span>}
                    {isNegative && !isSel && <span className="ml-1">⚠</span>}
                    {isSel && <span className="ml-1 text-blue-400">›</span>}
                  </th>
                );
              })}
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
  const qc = useQueryClient();
  const [batchState, setBatchState] = useState<'idle' | 'selecting' | 'saving'>('idle');
  const [checkedBills,    setCheckedBills]    = useState<Set<string>>(new Set());
  const [checkedIncome,   setCheckedIncome]   = useState<Set<string>>(new Set());
  const [activePanelCell, setActivePanelCell] = useState<ActiveCell>(null);
  const [showCloseModal,  setShowCloseModal]  = useState(false);
  const [cascadeDialog,   setCascadeDialog]   = useState<ReopenResult | null>(null);
  const reopenMutation = useReopenPeriod();
  const moveMutation   = useMoveInstance();

  const handleReopen = async () => {
    const result = await reopenMutation.mutateAsync({ periodId: period.id });
    if (result.requiresCascade) {
      setCascadeDialog(result);
    }
  };

  const handleReopenCascade = async () => {
    setCascadeDialog(null);
    await reopenMutation.mutateAsync({ periodId: period.id, cascade: true });
  };

  const projected = period.balanceSnapshot?.runningBalance;
  const planned   = period.balanceSnapshot?.plannedBalance;
  const diff      = (projected ?? 0) - (planned ?? 0);

  const incomeItems = incomeGrid.sources
    .map((s) => ({ source: s, entry: incomeGrid.entryMap[s.id]?.[period.id] }))
    .filter((x): x is { source: IncomeSource; entry: IncomeGridEntry } => x.entry != null);

  const orderMap = Object.fromEntries(billGrid.groups.map((g, i) => [g, i]));
  const billGroups = Object.entries(
    billGrid.templates
      .filter((t) => billGrid.instanceMap[t.id]?.[period.id])
      .reduce<Record<string, BillTemplate[]>>((acc, t) => {
        (acc[t.group] ??= []).push(t);
        return acc;
      }, {})
  ).sort(([a], [b]) => (orderMap[a] ?? 9999) - (orderMap[b] ?? 9999));

  const unreconciledBillIds = billGroups.flatMap(([, ts]) => ts)
    .filter((t) => !billGrid.instanceMap[t.id][period.id].isReconciled)
    .map((t) => billGrid.instanceMap[t.id][period.id].id);
  const unreconciledIncomeIds = incomeItems
    .filter(({ entry }) => !entry.isReconciled)
    .map(({ entry }) => entry.id);
  const unreconciledCount = unreconciledBillIds.length + unreconciledIncomeIds.length;
  const checkedCount = checkedBills.size + checkedIncome.size;

  const enterSelecting = () => {
    setCheckedBills(new Set(unreconciledBillIds));
    setCheckedIncome(new Set(unreconciledIncomeIds));
    setBatchState('selecting');
  };

  const cancelSelecting = () => {
    setBatchState('idle');
    setCheckedBills(new Set());
    setCheckedIncome(new Set());
  };

  const handleBatchReconcile = async () => {
    setBatchState('saving');
    try {
      await api.post(`/api/reconciliation/period/${period.id}/batch`, {
        billInstanceIds:  [...checkedBills],
        incomeEntryIds:   [...checkedIncome],
      });
      await qc.invalidateQueries({ queryKey: ['billGrid'] });
      await qc.invalidateQueries({ queryKey: ['incomeGrid'] });
      await qc.invalidateQueries({ queryKey: ['payPeriods'] });
    } finally {
      setBatchState('idle');
      setCheckedBills(new Set());
      setCheckedIncome(new Set());
    }
  };

  const toggleBill = (id: string) => setCheckedBills((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleIncome = (id: string) => setCheckedIncome((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

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
          {period.isClosed && (
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-gray-500 border border-gray-700 px-2 py-0.5 rounded">
              🔒 Closed
            </span>
          )}
          {unreconciledCount > 0 && batchState === 'idle' && !period.isClosed && (
            <div className="mt-2">
              <button
                onClick={enterSelecting}
                className="text-[11px] text-gray-500 hover:text-green-400 border border-gray-700 hover:border-green-700 px-2 py-0.5 rounded transition-colors"
              >
                Reconcile all ({unreconciledCount})
              </button>
            </div>
          )}
          {batchState === 'selecting' && (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={handleBatchReconcile}
                disabled={checkedCount === 0}
                className="text-[11px] bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-2 py-0.5 rounded transition-colors"
              >
                Reconcile {checkedCount} selected
              </button>
              <button
                onClick={cancelSelecting}
                className="text-[11px] text-gray-500 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
          {batchState === 'saving' && (
            <p className="mt-2 text-[11px] text-gray-500">Reconciling…</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {!period.isClosed ? (
            <button
              onClick={() => setShowCloseModal(true)}
              className="text-[11px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white border border-gray-700 transition-colors"
            >
              🔒 Close Period
            </button>
          ) : (
            <button
              onClick={handleReopen}
              disabled={reopenMutation.isPending}
              className="text-[11px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white border border-gray-700 transition-colors disabled:opacity-50"
            >
              🔓 {reopenMutation.isPending ? '…' : 'Reopen'}
            </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-xl leading-none transition-colors"
          >
            ✕
          </button>
        </div>
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
            <div key={source.id}>
              <div className="flex items-center gap-2 py-1.5">
                {batchState === 'selecting' && !entry.isReconciled && (
                  <input
                    type="checkbox"
                    checked={checkedIncome.has(entry.id)}
                    onChange={() => toggleIncome(entry.id)}
                    className="shrink-0 accent-green-500 cursor-pointer"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-gray-300">{source.name}</span>
                  {entry.notes && <p className="text-[10px] text-gray-600 italic truncate">{entry.notes}</p>}
                </div>
                {activePanelCell?.id !== entry.id && (
                  <button
                    onClick={() => batchState === 'idle' && setActivePanelCell({ type: 'income', id: entry.id, mode: entry.isReconciled ? 'unreconcile' : 'reconcile' })}
                    className={`text-right shrink-0 rounded px-1 transition-colors ${batchState === 'idle' ? 'hover:bg-gray-800 cursor-pointer' : 'cursor-default'}`}
                    title={batchState === 'idle' ? (entry.isReconciled ? 'Click to un-reconcile' : 'Click to reconcile') : undefined}
                  >
                    <span className="inline-flex items-center gap-1 text-xs text-green-300">
                      <span>{fmt(entry.isReconciled ? entry.actualAmount : entry.projectedAmount)}</span>
                      <span className="w-3 text-left">{entry.isReconciled ? '✓' : ''}</span>
                    </span>
                  </button>
                )}
              </div>
              {activePanelCell?.id === entry.id && (
                <div className="pb-2">
                  {activePanelCell.mode === 'reconcile' ? (
                    <ReconcileInput
                      defaultValue={entry.actualAmount ?? entry.projectedAmount}
                      onDraftSave={async (amount, cascade) => {
                        await api.patch(`/api/income/entry/${entry.id}`, { projectedAmount: amount, cascade });
                        await qc.invalidateQueries({ queryKey: ['incomeGrid'] });
                        await qc.invalidateQueries({ queryKey: ['payPeriods'] });
                        setActivePanelCell(null);
                      }}
                      onReconcile={async (amount, cascade) => {
                        await api.post(`/api/reconciliation/income/${entry.id}`, { actualAmount: amount, cascade });
                        await qc.invalidateQueries({ queryKey: ['incomeGrid'] });
                        await qc.invalidateQueries({ queryKey: ['payPeriods'] });
                        setActivePanelCell(null);
                      }}
                      onCancel={() => setActivePanelCell(null)}
                    />
                  ) : (
                    <UnreconcileConfirm
                      onConfirm={async () => {
                        await api.delete(`/api/reconciliation/income/${entry.id}`);
                        await qc.invalidateQueries({ queryKey: ['incomeGrid'] });
                        await qc.invalidateQueries({ queryKey: ['payPeriods'] });
                        setActivePanelCell(null);
                      }}
                      onCancel={() => setActivePanelCell(null)}
                    />
                  )}
                </div>
              )}
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
            const color = t.billType === 'SAVINGS' ? 'text-emerald-300' : t.billType === 'TRANSFER' ? 'text-sky-300' : 'text-orange-300';
            return (
              <div key={t.id}>
                <div className="flex items-center gap-2 py-1.5">
                  {batchState === 'selecting' && !inst.isReconciled && (
                    <input
                      type="checkbox"
                      checked={checkedBills.has(inst.id)}
                      onChange={() => toggleBill(inst.id)}
                      className="shrink-0 accent-green-500 cursor-pointer"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-gray-300">{t.name}</span>
                    {inst.notes && <p className="text-[10px] text-gray-600 italic truncate">{inst.notes}</p>}
                  </div>
                  {activePanelCell?.id !== inst.id && (
                    <button
                      onClick={() => batchState === 'idle' && setActivePanelCell({ type: 'bill', id: inst.id, mode: inst.isFrozen ? 'unreconcile' : 'reconcile' })}
                      className={`text-right shrink-0 rounded px-1 transition-colors ${batchState === 'idle' ? 'hover:bg-gray-800 cursor-pointer' : 'cursor-default'}`}
                      title={batchState === 'idle' ? (inst.isFrozen ? 'Click to un-reconcile' : 'Click to reconcile') : undefined}
                    >
                      <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
                        <span>{fmt(inst.isReconciled ? inst.actualAmount : inst.projectedAmount)}</span>
                        <span className="w-3 text-left">{inst.isReconciled ? '✓' : ''}</span>
                      </span>
                    </button>
                  )}
                </div>
                {activePanelCell?.id === inst.id && (
                  <div className="pb-2">
                    {activePanelCell.mode === 'reconcile' ? (
                      <ReconcileInput
                        defaultValue={inst.actualAmount ?? inst.projectedAmount}
                        onDraftSave={async (val, cascade) => {
                          await api.patch(`/api/bills/instance/${inst.id}`, { projectedAmount: val, cascade });
                          await qc.invalidateQueries({ queryKey: ['billGrid'] });
                          await qc.invalidateQueries({ queryKey: ['payPeriods'] });
                          setActivePanelCell(null);
                        }}
                        onReconcile={async (val, cascade) => {
                          await api.post(`/api/reconciliation/bill/${inst.id}`, { actualAmount: val, cascade });
                          await qc.invalidateQueries({ queryKey: ['billGrid'] });
                          await qc.invalidateQueries({ queryKey: ['payPeriods'] });
                          setActivePanelCell(null);
                        }}
                        onCancel={() => setActivePanelCell(null)}
                        onMove={!inst.isReconciled ? async () => {
                          await moveMutation.mutateAsync({ periodId: period.id, billInstanceId: inst.id });
                          setActivePanelCell(null);
                        } : undefined}
                      />
                    ) : (
                      <UnreconcileConfirm
                        onConfirm={async () => {
                          await api.delete(`/api/reconciliation/bill/${inst.id}`);
                          await qc.invalidateQueries({ queryKey: ['billGrid'] });
                          await qc.invalidateQueries({ queryKey: ['payPeriods'] });
                          setActivePanelCell(null);
                        }}
                        onCancel={() => setActivePanelCell(null)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {showCloseModal && (
        <ClosePeriodModal
          periodId={period.id}
          paydayLabel={fmtDate(period.paydayDate)}
          onClose={() => setShowCloseModal(false)}
        />
      )}

      {cascadeDialog?.requiresCascade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-white font-semibold mb-2">Reopen multiple periods?</h3>
            <p className="text-gray-400 text-sm mb-3">
              Reopening this period requires also reopening {cascadeDialog.laterClosedPeriods!.length} later closed period{cascadeDialog.laterClosedPeriods!.length > 1 ? 's' : ''}:
            </p>
            <ul className="text-xs text-gray-500 mb-4 space-y-1 pl-3">
              {cascadeDialog.laterClosedPeriods!.map((p) => (
                <li key={p.id}>• {fmtDate(p.paydayDate)}</li>
              ))}
            </ul>
            <p className="text-gray-500 text-xs mb-4">
              Transactions already reconciled in those periods will remain reconciled.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setCascadeDialog(null)}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReopenCascade}
                disabled={reopenMutation.isPending}
                className="text-sm bg-yellow-700 hover:bg-yellow-600 text-white px-4 py-1.5 rounded transition-colors disabled:opacity-50"
              >
                {reopenMutation.isPending ? 'Reopening…' : 'Reopen all'}
              </button>
            </div>
          </div>
        </div>
      )}
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
                  await api.patch(`/api/income/entry/${entry.id}`, { projectedAmount: amount, cascade });
                  setActiveCell(null);
                }}
                onReconcile={async (amount, cascade) => {
                  await api.post(`/api/reconciliation/income/${entry.id}`, { actualAmount: amount, cascade });
                  setActiveCell(null);
                }}
                onCancel={() => setActiveCell(null)}
              />
            ) : mode === 'unreconcile' ? (
              <UnreconcileConfirm
                onConfirm={async () => {
                  await api.delete(`/api/reconciliation/income/${entry.id}`);
                  setActiveCell(null);
                }}
                onCancel={() => setActiveCell(null)}
              />
            ) : (
              <ReconcileCell
                amount={entry.isReconciled ? (entry.actualAmount ?? entry.projectedAmount) : entry.projectedAmount}
                isReconciled={entry.isReconciled}
                colorClass="text-green-300"
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
  const moveMutation = useMoveInstance();
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
        const billColor = amount === 0
          ? 'text-gray-600'
          : template.billType === 'SAVINGS'
            ? 'text-emerald-300'
            : template.billType === 'TRANSFER'
              ? 'text-sky-300'
              : 'text-orange-300';
        return (
          <td key={p.id} className={`py-1 px-2 text-center ${isSel ? 'bg-blue-950/20' : ''}`}>
            {mode === 'reconcile' ? (
              <ReconcileInput
                defaultValue={inst.actualAmount ?? inst.projectedAmount}
                onDraftSave={async (val, cascade) => {
                  await api.patch(`/api/bills/instance/${inst.id}`, { projectedAmount: val, cascade });
                  setActiveCell(null);
                }}
                onReconcile={async (val, cascade) => {
                  await api.post(`/api/reconciliation/bill/${inst.id}`, { actualAmount: val, cascade });
                  setActiveCell(null);
                }}
                onCancel={() => setActiveCell(null)}
                onMove={!inst.isReconciled ? async () => {
                  await moveMutation.mutateAsync({ periodId: p.id, billInstanceId: inst.id });
                  setActiveCell(null);
                } : undefined}
              />
            ) : mode === 'unreconcile' ? (
              <UnreconcileConfirm
                onConfirm={async () => {
                  await api.delete(`/api/reconciliation/bill/${inst.id}`);
                  setActiveCell(null);
                }}
                onCancel={() => setActiveCell(null)}
              />
            ) : (
              <ReconcileCell
                amount={amount}
                isReconciled={inst.isReconciled}
                colorClass={billColor}
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
      className={`w-full text-xs whitespace-nowrap px-1 py-1 rounded hover:bg-gray-800 transition-colors ${colorClass} cursor-pointer`}
    >
      <span className="inline-grid w-full" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
        <span />
        <span>{amount > 0 ? fmt(amount) : '—'}</span>
        <span className="text-right pl-1">{isReconciled && amount > 0 ? '✓' : ''}</span>
      </span>
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
  defaultValue, onDraftSave, onReconcile, onCancel, onMove,
}: {
  defaultValue: number;
  onDraftSave: (amount: number, cascade: boolean) => Promise<void>;
  onReconcile: (amount: number, cascade: boolean) => Promise<void>;
  onCancel: () => void;
  onMove?: () => Promise<void>;
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
        {onMove && (
          <button
            onClick={async () => { setSaving(true); try { await onMove(); } finally { setSaving(false); } }}
            disabled={saving}
            title="Move to next period"
            className="text-[9px] px-1.5 py-0.5 rounded border border-gray-600 text-gray-400 hover:text-blue-400 hover:border-blue-600 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            Move →
          </button>
        )}
      </div>
    </div>
  );
}
