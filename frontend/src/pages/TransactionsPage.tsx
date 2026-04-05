import { useState, useRef, useMemo, useEffect } from 'react';
import {
  useTransactions,
  useImportTransactions,
  useMatchTransaction,
  useUnmatchTransaction,
  useIgnoreTransaction,
  useDeleteTransaction,
  useMatchCandidates,
  useImportBatches,
  useDeleteImportBatch,
  useAutoMatchRules,
  useCreateAutoMatchRule,
  useUpdateAutoMatchRule,
  useDeleteAutoMatchRule,
  useApplyAutoMatchRules,
  useCreateManualTransaction,
} from '../hooks/useTransactions';
import { useBillTemplates } from '../hooks/useTemplates';
import { useIncomeSources } from '../hooks/useTemplates';
import { usePayPeriods } from '../hooks/usePayPeriods';
import type { Transaction, AutoMatchRule, MatchCandidate, PayPeriod } from '../types';
import { useAccount } from '../context/AccountContext';

type Tab = 'inbox' | 'all' | 'history' | 'rules';
type SortCol = 'date' | 'description' | 'amount' | 'status';
type SortDir = 'asc' | 'desc';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// ── Sort / filter helpers ─────────────────────────────────────────────────────

function matchLabel(txn: Transaction): string {
  if (txn.billInstance) return txn.billInstance.billTemplate.name;
  if (txn.incomeEntry) return txn.incomeEntry.incomeSource.name;
  return '';
}

function filterAndSort(
  txns: Transaction[],
  search: string,
  sortCol: SortCol,
  sortDir: SortDir,
): Transaction[] {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? txns.filter((t) =>
        t.description.toLowerCase().includes(q) ||
        (t.memo ?? '').toLowerCase().includes(q) ||
        matchLabel(t).toLowerCase().includes(q),
      )
    : txns;

  return [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortCol === 'date') {
      cmp = a.date.localeCompare(b.date);
      if (cmp === 0) {
        // Same day: income (positive) always before expenses (negative), matching bank statement order
        const aIsExpense = a.amount < 0 ? 1 : 0;
        const bIsExpense = b.amount < 0 ? 1 : 0;
        return aIsExpense - bIsExpense;
      }
    } else if (sortCol === 'description') cmp = a.description.localeCompare(b.description);
    else if (sortCol === 'amount') cmp = Math.abs(a.amount) - Math.abs(b.amount);
    else if (sortCol === 'status') cmp = a.status.localeCompare(b.status);
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

// ── Sortable header cell ──────────────────────────────────────────────────────

function SortTh({
  label, col, active, dir, onSort, className = '',
}: {
  label: string; col: SortCol; active: SortCol; dir: SortDir;
  onSort: (col: SortCol) => void; className?: string;
}) {
  const isActive = active === col;
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider select-none transition-colors ${
        isActive ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
      } ${className}`}
    >
      {label}
      <span className="text-[9px]">{isActive ? (dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </button>
  );
}

// ── Match Picker Modal ────────────────────────────────────────────────────────

function MatchPicker({
  transaction,
  onClose,
  onRuleCreated,
}: {
  transaction: Transaction;
  onClose: () => void;
  onRuleCreated?: (pattern: string, targetName: string) => void;
}) {
  const matchMutation = useMatchTransaction();
  const createRule = useCreateAutoMatchRule();
  const applyRules = useApplyAutoMatchRules();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 2: pending rule proposal after candidate selected
  const [pendingCandidate, setPendingCandidate] = useState<MatchCandidate | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(emptyRuleForm);

  function handleSearchChange(val: string) {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 200);
  }

  const { data: candidates = [], isLoading } = useMatchCandidates(transaction.id, debouncedSearch || undefined);

  function selectCandidate(c: MatchCandidate) {
    setPendingCandidate(c);
    setRuleForm({
      pattern: transaction.description,
      matchType: 'CONTAINS',
      targetType: c.type,
      targetId: c.templateId,
      priority: 0,
      amountOperator: null,
      amountValue: '',
      amountValue2: '',
    });
  }

  async function confirmMatch(createRuleFlag: boolean) {
    if (!pendingCandidate) return;
    const c = pendingCandidate;

    if (c.kind === 'TEMPLATE' && c.type === 'BILL') {
      await matchMutation.mutateAsync({ id: transaction.id, billTemplateId: c.id });
    } else if (c.kind === 'TEMPLATE' && c.type === 'INCOME') {
      await matchMutation.mutateAsync({ id: transaction.id, incomeSourceId: c.id });
    } else if (c.type === 'BILL') {
      await matchMutation.mutateAsync({ id: transaction.id, billInstanceId: c.id });
    } else {
      await matchMutation.mutateAsync({ id: transaction.id, incomeEntryId: c.id });
    }

    if (createRuleFlag) {
      try {
        await createRule.mutateAsync({
          ...ruleForm,
          amountValue: ruleForm.amountValue ? parseFloat(ruleForm.amountValue) : null,
          amountValue2: ruleForm.amountValue2 ? parseFloat(ruleForm.amountValue2) : null,
        });
        onRuleCreated?.(ruleForm.pattern, c.name);
        applyRules.mutate(); // run rules against remaining unmatched transactions
      } catch {
        // Rule may already exist — ignore silently
      }
    }

    onClose();
  }

  const { data: billTemplates = [] } = useBillTemplates();
  const { data: incomeSources = [] } = useIncomeSources();

  const isBusy = matchMutation.isPending || createRule.isPending;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-3 min-w-0">
            {pendingCandidate && (
              <button onClick={() => setPendingCandidate(null)} className="text-gray-500 hover:text-white text-lg leading-none shrink-0">‹</button>
            )}
            <span className="text-sm font-semibold text-white truncate">{transaction.description}</span>
            <span className="text-sm font-mono text-gray-300 shrink-0">{fmt.format(Math.abs(transaction.amount))}</span>
          </div>
          <button onClick={onClose} className="ml-3 text-gray-500 hover:text-white shrink-0">✕</button>
        </div>

        {/* Step 1 — pick a candidate */}
        {!pendingCandidate && (
          <>
            <div className="px-3 py-2 border-b border-gray-800">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search expenses & income…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: '300px' }}>
              {isLoading && <p className="text-xs text-gray-500 text-center py-6">Searching…</p>}
              {!isLoading && candidates.length === 0 && !debouncedSearch && (
                <p className="text-xs text-gray-500 text-center py-6">No unreconciled items within ±14 days — type to search all</p>
              )}
              {!isLoading && candidates.length === 0 && debouncedSearch && (
                <p className="text-xs text-gray-500 text-center py-6">No matches for "{debouncedSearch}"</p>
              )}
              {!isLoading && candidates.map((c) => (
                <button
                  key={`${c.kind}-${c.id}`}
                  onClick={() => selectCandidate(c)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 last:border-0 hover:bg-gray-800 text-left transition-colors"
                >
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${c.type === 'BILL' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
                    {c.type === 'BILL' ? 'EXP' : 'INC'}
                  </span>
                  <span className="flex-1 text-sm text-gray-200 truncate">{c.name}</span>
                  <span className="text-sm font-mono text-gray-300 shrink-0">{fmt.format(c.projectedAmount)}</span>
                  <span className="text-xs text-gray-500 shrink-0 w-20 text-right">
                    {c.paydayDate ? fmtDate(c.paydayDate) : <span className="italic text-gray-600">discretionary</span>}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 2 — confirm match + optionally edit/skip rule */}
        {pendingCandidate && (
          <div className="p-4 space-y-4">
            {/* Proposed match summary */}
            <div className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${pendingCandidate.type === 'BILL' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
                {pendingCandidate.type === 'BILL' ? 'EXP' : 'INC'}
              </span>
              <span className="flex-1 text-sm text-gray-200">{pendingCandidate.name}</span>
              <span className="text-sm font-mono text-gray-300">{fmt.format(pendingCandidate.projectedAmount)}</span>
            </div>

            {/* Rule proposal */}
            <div className="border border-gray-700 rounded-xl p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Auto-match rule</p>

              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Pattern</label>
                  <input
                    type="text"
                    value={ruleForm.pattern}
                    onChange={(e) => setRuleForm((f) => ({ ...f, pattern: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Match Type</label>
                  <select
                    value={ruleForm.matchType}
                    onChange={(e) => setRuleForm((f) => ({ ...f, matchType: e.target.value as RuleForm['matchType'] }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white"
                  >
                    <option value="CONTAINS">Contains</option>
                    <option value="STARTS_WITH">Starts With</option>
                    <option value="REGEX">Regex</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Target</label>
                  <select
                    value={ruleForm.targetId}
                    onChange={(e) => setRuleForm((f) => ({ ...f, targetId: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white"
                  >
                    {(ruleForm.targetType === 'BILL' ? billTemplates : incomeSources).map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Priority</label>
                  <input
                    type="number"
                    value={ruleForm.priority}
                    onChange={(e) => setRuleForm((f) => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono"
                  />
                </div>

                {/* Amount filter */}
                <div className="col-span-2 border-t border-gray-700/50 pt-2">
                  <label className="block text-xs text-gray-500 mb-1.5">Amount Filter</label>
                  <div className="flex gap-1.5 items-center flex-nowrap">
                    <select
                      value={ruleForm.amountOperator ?? ''}
                      onChange={(e) => setRuleForm((f) => ({ ...f, amountOperator: (e.target.value || null) as RuleForm['amountOperator'], amountValue2: '' }))}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1 text-xs text-white shrink-0"
                    >
                      <option value="">Any amount</option>
                      <option value="EXACT">Exactly</option>
                      <option value="LT">Less than</option>
                      <option value="LTE">≤</option>
                      <option value="GT">Greater than</option>
                      <option value="GTE">≥</option>
                      <option value="BETWEEN">Between</option>
                    </select>
                    {ruleForm.amountOperator && (
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-xs text-gray-500 shrink-0">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={ruleForm.amountValue}
                          onChange={(e) => setRuleForm((f) => ({ ...f, amountValue: e.target.value }))}
                          placeholder="0.00"
                          className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white font-mono"
                        />
                        {ruleForm.amountOperator === 'BETWEEN' && (
                          <>
                            <span className="text-xs text-gray-500 shrink-0">– $</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={ruleForm.amountValue2}
                              onChange={(e) => setRuleForm((f) => ({ ...f, amountValue2: e.target.value }))}
                              placeholder="0.00"
                              className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white font-mono"
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => confirmMatch(false)}
                disabled={isBusy}
                className="flex-1 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm disabled:opacity-50"
              >
                Match, no rule
              </button>
              <button
                type="button"
                onClick={() => confirmMatch(true)}
                disabled={isBusy || !ruleForm.pattern || !ruleForm.targetId}
                className="flex-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {isBusy ? 'Saving…' : 'Match & Create Rule'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Manual Entry Modal ────────────────────────────────────────────────────────

function ManualEntryModal({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [memo, setMemo] = useState('');
  const createMutation = useCreateManualTransaction();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || !description || !date) return;
    await createMutation.mutateAsync({ date, amount: amt, description, memo: memo || undefined });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">Add Manual Transaction</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" required />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Amount (negative = expense)</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="-45.00"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono" required />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="WALMART STORE"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" required />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Memo (optional)</label>
            <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700">Cancel</button>
            <button type="submit" disabled={createMutation.isPending}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50">
              {createMutation.isPending ? 'Saving…' : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Transaction Row ───────────────────────────────────────────────────────────

function TransactionRow({
  txn,
  onMatch,
  runningBalance,
}: {
  txn: Transaction;
  onMatch: (txn: Transaction) => void;
  runningBalance?: number;
}) {
  const unmatch = useUnmatchTransaction();
  const ignore = useIgnoreTransaction();
  const deleteTxn = useDeleteTransaction();
  const isExpense = txn.amount < 0;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-800 last:border-0 group">
      <span className="text-xs text-gray-500 w-24 shrink-0">{fmtDate(txn.date)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-200 truncate">{txn.description}</p>
        {txn.memo && txn.memo !== txn.description && (
          <p className="text-xs text-gray-600 truncate">{txn.memo}</p>
        )}
        {txn.status === 'MATCHED' && txn.billInstance && (
          <p className="text-xs text-green-500">→ {txn.billInstance.billTemplate.name}</p>
        )}
        {txn.status === 'MATCHED' && txn.incomeEntry && (
          <p className="text-xs text-green-500">→ {txn.incomeEntry.incomeSource.name}</p>
        )}
      </div>
      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 shrink-0">{txn.source}</span>
      <span className={`text-sm font-mono font-semibold w-24 text-right shrink-0 ${isExpense ? 'text-red-400' : 'text-green-400'}`}>
        {isExpense ? '-' : '+'}{fmt.format(Math.abs(txn.amount))}
      </span>
      {runningBalance !== undefined && (
        <span className={`text-sm font-mono w-28 text-right shrink-0 ${runningBalance < 0 ? 'text-red-400' : 'text-gray-300'}`}>
          {fmt.format(runningBalance)}
        </span>
      )}
      <div className="w-28 flex items-center justify-end gap-1.5 shrink-0">
        {txn.status === 'UNMATCHED' && (
          <>
            <button onClick={() => onMatch(txn)} className="text-xs px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white">Match</button>
            <button onClick={() => ignore.mutate({ id: txn.id, ignore: true })} disabled={ignore.isPending}
              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300">Ignore</button>
          </>
        )}
        {txn.status === 'MATCHED' && (
          <button onClick={() => unmatch.mutate(txn.id)} disabled={unmatch.isPending}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-red-300">Unmatch</button>
        )}
        {txn.status === 'IGNORED' && (
          <button onClick={() => ignore.mutate({ id: txn.id, ignore: false })} disabled={ignore.isPending}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-400">Restore</button>
        )}
        {txn.source === 'MANUAL' && (
          <button onClick={() => deleteTxn.mutate(txn.id)} disabled={deleteTxn.isPending}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-red-900 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100">Del</button>
        )}
      </div>
    </div>
  );
}

// ── Shared transaction list with search + sort ────────────────────────────────

function TransactionList({
  transactions,
  isLoading,
  onMatch,
  emptyMessage = 'No transactions found',
  extraControls,
  sortCol,
  sortDir,
  onSort,
  runningBalanceMap,
}: {
  transactions: Transaction[];
  isLoading: boolean;
  onMatch: (txn: Transaction) => void;
  emptyMessage?: React.ReactNode;
  extraControls?: React.ReactNode;
  sortCol: SortCol;
  sortDir: SortDir;
  onSort: (col: SortCol) => void;
  runningBalanceMap?: Map<string, number>;
}) {
  const [search, setSearch] = useState('');

  const visible = useMemo(
    () => filterAndSort(transactions, search, sortCol, sortDir),
    [transactions, search, sortCol, sortDir],
  );

  const showBalance = !!runningBalanceMap;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar: search + extra controls — frozen */}
      <div className="shrink-0 flex items-center gap-3 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description, memo, or matched name…"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-xs text-gray-500 hover:text-white">Clear</button>
        )}
        {extraControls}
      </div>

      {/* Column headers — frozen */}
      <div className="shrink-0 flex items-center gap-3 px-0 pb-1.5 border-b border-gray-700">
        <SortTh label="Date"        col="date"        active={sortCol} dir={sortDir} onSort={onSort} className="w-24 shrink-0" />
        <SortTh label="Description" col="description" active={sortCol} dir={sortDir} onSort={onSort} className="flex-1" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 shrink-0">Source</span>
        <SortTh label="Amount"      col="amount"      active={sortCol} dir={sortDir} onSort={onSort} className="w-24 shrink-0 justify-end" />
        {showBalance && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 w-28 text-right shrink-0">Balance</span>
        )}
        <SortTh label="Status"      col="status"      active={sortCol} dir={sortDir} onSort={onSort} className="w-28 shrink-0 justify-end" />
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-1">
        {isLoading && <p className="text-sm text-gray-500 text-center py-8">Loading…</p>}
        {!isLoading && visible.length === 0 && (
          <div className="text-center py-12">
            {search ? (
              <p className="text-sm text-gray-500">No results for "{search}"</p>
            ) : (
              typeof emptyMessage === 'string'
                ? <p className="text-sm text-gray-500">{emptyMessage}</p>
                : emptyMessage
            )}
          </div>
        )}
        {visible.map((t) => (
          <TransactionRow key={t.id} txn={t} onMatch={onMatch} runningBalance={runningBalanceMap?.get(t.id)} />
        ))}
        {visible.length > 0 && visible.length !== transactions.length && (
          <p className="text-xs text-gray-600 text-center pt-2">{visible.length} of {transactions.length} shown</p>
        )}
      </div>
    </div>
  );
}

// ── Inbox Tab ─────────────────────────────────────────────────────────────────

function InboxTab({
  onMatch, sortCol, sortDir, onSort,
}: {
  onMatch: (txn: Transaction) => void;
  sortCol: SortCol; sortDir: SortDir; onSort: (col: SortCol) => void;
}) {
  const { data, isLoading } = useTransactions({ status: 'UNMATCHED', limit: 500 });
  const transactions = data?.transactions ?? [];

  return (
    <TransactionList
      transactions={transactions}
      isLoading={isLoading}
      onMatch={onMatch}
      sortCol={sortCol}
      sortDir={sortDir}
      onSort={onSort}
      emptyMessage={
        <div>
          <p className="text-4xl mb-3">✓</p>
          <p className="text-gray-400 font-medium">Inbox zero — all transactions matched or ignored</p>
        </div>
      }
    />
  );
}

// ── Period Break Row ──────────────────────────────────────────────────────────

function PeriodBreakRow({
  period,
  txns,
  runningBalanceMap,
  isMonthly,
  onRefReady,
}: {
  period: PayPeriod;
  txns: Transaction[];
  runningBalanceMap: Map<string, number>;
  isMonthly: boolean;
  onRefReady: (el: HTMLDivElement | null) => void;
}) {
  const incomeTotal = txns.reduce((s, t) => t.amount > 0 ? s + t.amount : s, 0);
  const expenseTotal = txns.reduce((s, t) => t.amount < 0 ? s + Math.abs(t.amount) : s, 0);
  const fmtShort = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // Closing balance = running balance after the last transaction in this period
  const lastTxn = [...txns].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return (a.amount < 0 ? 1 : 0) - (b.amount < 0 ? 1 : 0);
  }).at(-1);
  const closingBalance = lastTxn ? runningBalanceMap.get(lastTxn.id) : undefined;

  const predicted = period.balanceSnapshot?.totalExpenses ?? 0;
  const matched = txns
    .filter(t => t.status === 'MATCHED' && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const diff = predicted - matched;

  return (
    <div
      ref={onRefReady}
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg my-2 text-xs ${
        period.isClosed
          ? 'bg-gray-800 border border-gray-700'
          : 'bg-blue-950/60 border border-blue-900/50'
      }`}
    >
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-semibold text-gray-200">
          {isMonthly
            ? new Date(period.paydayDate.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
            : `${fmtShort(period.startDate)} – ${fmtShort(period.endDate)}`}
        </span>
        {!isMonthly && <span className="text-gray-500">Payday {fmtDate(period.paydayDate)}</span>}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
          period.isClosed ? 'bg-gray-700 text-gray-400' : 'bg-blue-900/60 text-blue-300'
        }`}>
          {period.isClosed ? 'Closed' : 'Open'}
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-4 shrink-0 flex-wrap">
        <span className="text-gray-500">
          Income: <span className="text-green-400 font-mono font-semibold">{fmt.format(incomeTotal)}</span>
        </span>
        <span className="text-gray-500">
          Expenses: <span className="text-red-400 font-mono font-semibold">{fmt.format(expenseTotal)}</span>
        </span>
        {period.isClosed ? (
          closingBalance !== undefined && (
            <span className="text-gray-500">
              Balance:{' '}
              <span className={`font-mono font-semibold ${closingBalance < 0 ? 'text-red-400' : 'text-gray-200'}`}>
                {fmt.format(closingBalance)}
              </span>
            </span>
          )
        ) : (
          <>
            <span className="text-gray-500">
              Predicted: <span className="font-mono text-gray-300">{fmt.format(predicted)}</span>
            </span>
            <span className="text-gray-500">
              Matched: <span className="font-mono text-gray-300">{fmt.format(matched)}</span>
            </span>
            <span className="text-gray-500">
              Diff:{' '}
              <span className={`font-mono font-semibold ${diff > 0.005 ? 'text-amber-400' : 'text-green-400'}`}>
                {diff >= 0 ? '+' : ''}{fmt.format(diff)}
              </span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ── All Transactions Tab ──────────────────────────────────────────────────────

function AllTab({ onMatch }: { onMatch: (txn: Transaction) => void }) {
  const [statusFilter, setStatusFilter] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [search, setSearch] = useState('');
  const [navIndex, setNavIndex] = useState(0);

  const { data, isLoading } = useTransactions({ limit: 5000 });
  const allTransactions = data?.transactions ?? [];
  const { data: periods = [] } = usePayPeriods();
  const { activeAccount } = useAccount();
  const isMonthly = activeAccount?.periodType === 'monthly';

  const sortedPeriods = useMemo(
    () => [...periods].sort((a, b) => a.paydayDate.localeCompare(b.paydayDate)),
    [periods],
  );

  // Running balance map anchored at earliest period's openingBalance
  const runningBalanceMap = useMemo(() => {
    const map = new Map<string, number>();
    if (allTransactions.length === 0) return map;
    const anchor = sortedPeriods.length > 0 ? sortedPeriods[0].openingBalance : 0;
    const sorted = [...allTransactions].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return (a.amount < 0 ? 1 : 0) - (b.amount < 0 ? 1 : 0);
    });
    let running = anchor;
    for (const txn of sorted) {
      running += txn.amount;
      map.set(txn.id, running);
    }
    return map;
  }, [allTransactions, sortedPeriods]);

  // All transactions grouped by pay period (preserving period order)
  const periodGroups = useMemo(() => {
    const groups = new Map<string, { period: PayPeriod; txns: Transaction[] }>();
    for (const p of sortedPeriods) groups.set(p.id, { period: p, txns: [] });
    for (const txn of allTransactions) {
      const p = sortedPeriods.find(p => p.startDate <= txn.date && txn.date <= p.endDate);
      if (p) groups.get(p.id)!.txns.push(txn);
    }
    return sortedPeriods.map(p => groups.get(p.id)!).filter(g => g.txns.length > 0);
  }, [allTransactions, sortedPeriods]);

  // Refs for period break rows (scroll targets)
  const periodRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Index of first unclosed period in periodGroups
  const currentPeriodIdx = useMemo(() => {
    const idx = periodGroups.findIndex(g => !g.period.isClosed);
    return idx === -1 ? Math.max(0, periodGroups.length - 1) : idx;
  }, [periodGroups]);

  // Init navIndex to current period once data loads
  useEffect(() => {
    if (periodGroups.length === 0) return;
    setNavIndex(currentPeriodIdx);
  }, [periodGroups.length, currentPeriodIdx]);

  function scrollToPeriod(idx: number) {
    const clamped = Math.max(0, Math.min(periodGroups.length - 1, idx));
    setNavIndex(clamped);
    periodRefs.current.get(periodGroups[clamped].period.id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  const showBreakRows = statusFilter === '';

  // Break-row mode: search+sort within each period group (totals always use original txns)
  const visibleGroups = useMemo(() => {
    if (!showBreakRows) return [];
    return periodGroups
      .map(g => ({ ...g, txns: filterAndSort(g.txns, search, sortCol, sortDir) }))
      .filter(g => g.txns.length > 0);
  }, [periodGroups, search, sortCol, sortDir, showBreakRows]);

  // Flat mode: status filter + search + sort
  const visibleFlat = useMemo(() => {
    if (showBreakRows) return [];
    return filterAndSort(allTransactions.filter(t => t.status === statusFilter), search, sortCol, sortDir);
  }, [allTransactions, statusFilter, search, sortCol, sortDir, showBreakRows]);

  const filteredCount = showBreakRows
    ? allTransactions.length
    : allTransactions.filter(t => t.status === statusFilter).length;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar — frozen */}
      <div className="shrink-0 flex items-center gap-3 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description, memo, or matched name…"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-xs text-gray-500 hover:text-white">Clear</button>
        )}
        {/* Period navigation — only visible when break rows are shown */}
        {showBreakRows && periodGroups.length > 0 && (
          <div className="flex items-center rounded-lg overflow-hidden border border-gray-700 shrink-0">
            <button
              onClick={() => scrollToPeriod(navIndex - 1)}
              disabled={navIndex <= 0}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Back in time (older period)"
            >←</button>
            <button
              onClick={() => scrollToPeriod(currentPeriodIdx)}
              className="px-2.5 py-1 text-xs text-blue-400 hover:text-blue-300 hover:bg-gray-700 border-x border-gray-700 transition-colors"
              title="Jump to current (first open) period"
            >Current</button>
            <button
              onClick={() => scrollToPeriod(navIndex + 1)}
              disabled={navIndex >= periodGroups.length - 1}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Forward in time (newer period)"
            >→</button>
          </div>
        )}
        {/* Status pills */}
        <div className="flex items-center gap-1.5 shrink-0">
          {['', 'UNMATCHED', 'MATCHED', 'IGNORED'].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                statusFilter === s
                  ? 'bg-blue-700 border-blue-600 text-white'
                  : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
              }`}>
              {s || 'All'}
            </button>
          ))}
          <span className="text-xs text-gray-600 ml-1">{data?.total ?? 0}</span>
        </div>
      </div>

      {/* Column headers — frozen */}
      <div className="shrink-0 flex items-center gap-3 px-0 pb-1.5 border-b border-gray-700">
        <SortTh label="Date"        col="date"        active={sortCol} dir={sortDir} onSort={handleSort} className="w-24 shrink-0" />
        <SortTh label="Description" col="description" active={sortCol} dir={sortDir} onSort={handleSort} className="flex-1" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 shrink-0">Source</span>
        <SortTh label="Amount"      col="amount"      active={sortCol} dir={sortDir} onSort={handleSort} className="w-24 shrink-0 justify-end" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 w-28 text-right shrink-0">Balance</span>
        <SortTh label="Status"      col="status"      active={sortCol} dir={sortDir} onSort={handleSort} className="w-28 shrink-0 justify-end" />
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-1">
        {isLoading && <p className="text-sm text-gray-500 text-center py-8">Loading…</p>}

        {/* Break-row mode */}
        {!isLoading && showBreakRows && (
          <>
            {visibleGroups.length === 0 && search && (
              <p className="text-sm text-gray-500 text-center py-12">No results for "{search}"</p>
            )}
            {visibleGroups.map(vg => {
              const origGroup = periodGroups.find(g => g.period.id === vg.period.id)!;
              return (
                <div key={vg.period.id}>
                  <PeriodBreakRow
                    period={vg.period}
                    txns={origGroup.txns}
                    runningBalanceMap={runningBalanceMap}
                    isMonthly={isMonthly}
                    onRefReady={el => {
                      if (el) periodRefs.current.set(vg.period.id, el);
                      else periodRefs.current.delete(vg.period.id);
                    }}
                  />
                  {vg.txns.map(t => (
                    <TransactionRow key={t.id} txn={t} onMatch={onMatch} runningBalance={runningBalanceMap.get(t.id)} />
                  ))}
                </div>
              );
            })}
          </>
        )}

        {/* Flat filtered mode */}
        {!isLoading && !showBreakRows && (
          <>
            {visibleFlat.length === 0 && (
              <div className="text-center py-12">
                {search
                  ? <p className="text-sm text-gray-500">No results for "{search}"</p>
                  : <p className="text-sm text-gray-500">No transactions</p>
                }
              </div>
            )}
            {visibleFlat.map(t => (
              <TransactionRow key={t.id} txn={t} onMatch={onMatch} runningBalance={runningBalanceMap.get(t.id)} />
            ))}
            {visibleFlat.length > 0 && visibleFlat.length !== filteredCount && (
              <p className="text-xs text-gray-600 text-center pt-2">
                {visibleFlat.length} of {filteredCount} shown
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Import History Tab ────────────────────────────────────────────────────────

function HistoryTab() {
  const { data: batches = [], isLoading } = useImportBatches();
  const deleteBatch = useDeleteImportBatch();

  return (
    <div className="h-full overflow-y-auto">
      {isLoading && <p className="text-sm text-gray-500 text-center py-8">Loading…</p>}
      {!isLoading && batches.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-8">No imports yet</p>
      )}
      {batches.map((b) => (
        <div key={b.id} className="flex items-center gap-4 py-3 border-b border-gray-800 last:border-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-200 font-medium truncate">{b.filename}</p>
            <p className="text-xs text-gray-500">{fmtDate(b.importedAt)}</p>
          </div>
          <div className="flex gap-4 text-xs text-right shrink-0">
            <div><p className="text-gray-400 font-medium">{b.importedCount}</p><p className="text-gray-600">imported</p></div>
            <div><p className="text-yellow-400 font-medium">{b.skippedCount}</p><p className="text-gray-600">skipped</p></div>
            <div><p className="text-green-400 font-medium">{b.matchedCount}</p><p className="text-gray-600">matched</p></div>
          </div>
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 shrink-0">{b.format}</span>
          <button
            onClick={() => { if (confirm(`Delete import "${b.filename}"? This will un-reconcile any matched transactions.`)) deleteBatch.mutate(b.id); }}
            disabled={deleteBatch.isPending}
            className="text-xs text-gray-600 hover:text-red-400 shrink-0"
          >Delete</button>
        </div>
      ))}
    </div>
  );
}

// ── Auto Match Rules Tab ──────────────────────────────────────────────────────

type RuleForm = {
  pattern: string;
  matchType: AutoMatchRule['matchType'];
  targetType: AutoMatchRule['targetType'];
  targetId: string;
  priority: number;
  amountOperator: AutoMatchRule['amountOperator'];
  amountValue: string;   // kept as string so input doesn't strip decimals mid-type
  amountValue2: string;
};

const emptyRuleForm: RuleForm = {
  pattern: '', matchType: 'CONTAINS', targetType: 'BILL', targetId: '', priority: 0,
  amountOperator: null, amountValue: '', amountValue2: '',
};

// ── Regex Builder ─────────────────────────────────────────────────────────────

function isValidRegex(pattern: string): boolean {
  try { new RegExp(pattern, 'i'); return true; } catch { return false; }
}

function testRegex(pattern: string, input: string): boolean {
  try { return new RegExp(pattern, 'i').test(input); } catch { return false; }
}

// Parse an AND-lookahead pattern back into its word list for the builder UI
function parseAndWords(pattern: string): string[] {
  const matches = [...pattern.matchAll(/\(\?=\.\*([^)]+)\)/g)];
  return matches.length > 0 ? matches.map((m) => m[1]) : [];
}

function buildAndPattern(words: string[]): string {
  return words.filter(Boolean).map((w) => `(?=.*${w})`).join('');
}

function RegexBuilder({ pattern, onChange }: { pattern: string; onChange: (p: string) => void }) {
  const [testInput, setTestInput] = useState('');
  const [andWords, setAndWords]   = useState<string[]>(() => {
    const parsed = parseAndWords(pattern);
    return parsed.length > 0 ? parsed : [''];
  });
  const [mode, setMode] = useState<'builder' | 'raw'>(() =>
    parseAndWords(pattern).length > 0 ? 'builder' : 'raw'
  );

  // Sync builder → pattern
  function updateAndWords(words: string[]) {
    setAndWords(words);
    const built = buildAndPattern(words);
    if (built) onChange(built);
  }

  // When user switches to raw, keep whatever pattern is there
  // When switching back to builder, try to parse it
  function handleModeSwitch(next: 'builder' | 'raw') {
    if (next === 'builder') {
      const parsed = parseAndWords(pattern);
      setAndWords(parsed.length > 0 ? parsed : ['']);
    }
    setMode(next);
  }

  const valid   = pattern === '' || isValidRegex(pattern);
  const matched = testInput ? testRegex(pattern, testInput) : null;

  const TEMPLATES = [
    { label: 'Starts with',  fn: (p: string) => `^${p}`,          placeholder: 'WALMART' },
    { label: 'Ends with',    fn: (p: string) => `${p}$`,           placeholder: 'PAYMENT' },
    { label: 'Whole word',   fn: (p: string) => `\\b${p}\\b`,      placeholder: 'AMAZON' },
    { label: 'Either word',  fn: (p: string) => p.split(' ').filter(Boolean).join('|'), placeholder: 'VISA MASTERCARD' },
  ];

  return (
    <div className="col-span-2 bg-gray-900/60 border border-blue-900/40 rounded-xl p-3 space-y-3">
      {/* Mode toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-blue-300">Regex Builder</span>
        <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
          {(['builder', 'raw'] as const).map((m) => (
            <button key={m} type="button" onClick={() => handleModeSwitch(m)}
              className={`px-3 py-1 capitalize transition-colors ${mode === m ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              {m === 'builder' ? '🔧 Builder' : '✏️ Raw'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'builder' ? (
        <div className="space-y-2">
          {/* AND words list */}
          <div className="space-y-1.5">
            <p className="text-[11px] text-gray-400 font-medium">All of these words must appear (AND logic):</p>
            {andWords.map((word, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-[10px] text-gray-600 w-6 text-right shrink-0">{i === 0 ? '' : '+'}</span>
                <input
                  type="text"
                  value={word}
                  onChange={(e) => {
                    const next = [...andWords];
                    next[i] = e.target.value;
                    updateAndWords(next);
                  }}
                  placeholder={i === 0 ? 'e.g. GENESIS' : 'e.g. MEMBERSHIP'}
                  className="flex-1 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none"
                />
                {andWords.length > 1 && (
                  <button type="button" onClick={() => updateAndWords(andWords.filter((_, j) => j !== i))}
                    className="text-gray-600 hover:text-red-400 text-xs px-1">✕</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => updateAndWords([...andWords, ''])}
              className="text-xs text-blue-400 hover:text-blue-300 ml-8">+ add word</button>
          </div>

          {/* Quick templates */}
          <div className="border-t border-gray-800 pt-2">
            <p className="text-[11px] text-gray-500 mb-1.5">Or use a template (switches to raw):</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button"
                  onClick={() => {
                    const val = prompt(`${t.label} — enter text (e.g. "${t.placeholder}"):`);
                    if (val) { onChange(t.fn(val.trim())); handleModeSwitch('raw'); }
                  }}
                  className="text-[11px] px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:border-blue-500 hover:text-white transition-colors">
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Raw mode — just show the pattern field with validation */
        <div className="space-y-1">
          <p className="text-[11px] text-gray-400">Edit the regex directly. Case-insensitive flag (i) is applied automatically.</p>
          {!valid && pattern && (
            <p className="text-[11px] text-red-400">⚠ Invalid regex — fix before saving</p>
          )}
        </div>
      )}

      {/* Generated pattern preview */}
      {pattern && (
        <div className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-1.5">
          <span className="text-[10px] text-gray-500 shrink-0">Pattern:</span>
          <code className={`text-xs flex-1 font-mono truncate ${valid ? 'text-green-300' : 'text-red-400'}`}>{pattern}</code>
          {!valid && <span className="text-[10px] text-red-400 shrink-0">invalid</span>}
        </div>
      )}

      {/* Live test input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          placeholder="Paste a transaction description to test…"
          className="flex-1 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
        />
        {testInput && matched !== null && (
          <span className={`text-xs font-semibold shrink-0 px-2 py-1 rounded ${matched ? 'text-green-300 bg-green-950/50' : 'text-red-400 bg-red-950/50'}`}>
            {matched ? '✓ match' : '✗ no match'}
          </span>
        )}
      </div>
    </div>
  );
}

function RuleFormFields({
  form, onChange, billTemplates, incomeSources,
}: {
  form: RuleForm;
  onChange: (f: RuleForm) => void;
  billTemplates: { id: string; name: string }[];
  incomeSources: { id: string; name: string }[];
}) {
  const targetOptions = form.targetType === 'BILL'
    ? billTemplates.map((t) => ({ id: t.id, name: t.name }))
    : incomeSources.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Pattern</label>
        <input type="text" value={form.pattern} onChange={(e) => onChange({ ...form, pattern: e.target.value })}
          placeholder={form.matchType === 'REGEX' ? '(?=.*word1)(?=.*word2)' : 'WALMART'}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono" required />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Match Type</label>
        <select value={form.matchType} onChange={(e) => onChange({ ...form, matchType: e.target.value as AutoMatchRule['matchType'] })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
          <option value="CONTAINS">Contains</option>
          <option value="STARTS_WITH">Starts With</option>
          <option value="REGEX">Regex</option>
        </select>
      </div>

      {/* Regex builder — spans full width when visible */}
      {form.matchType === 'REGEX' && (
        <RegexBuilder pattern={form.pattern} onChange={(p) => onChange({ ...form, pattern: p })} />
      )}

      <div>
        <label className="block text-xs text-gray-400 mb-1">Target Type</label>
        <select value={form.targetType} onChange={(e) => onChange({ ...form, targetType: e.target.value as AutoMatchRule['targetType'], targetId: '' })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
          <option value="BILL">Expense</option>
          <option value="INCOME">Income</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Target</label>
        <select value={form.targetId} onChange={(e) => onChange({ ...form, targetId: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" required>
          <option value="">Select…</option>
          {targetOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Priority (higher = first)</label>
        <input type="number" value={form.priority} onChange={(e) => onChange({ ...form, priority: parseInt(e.target.value) || 0 })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono" />
      </div>

      {/* Amount filter — spans full width */}
      <div className="col-span-2 border-t border-gray-700 pt-3">
        <label className="block text-xs text-gray-400 mb-2">Amount Filter <span className="text-gray-600">(optional — leave blank to match any amount)</span></label>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={form.amountOperator ?? ''}
            onChange={(e) => onChange({ ...form, amountOperator: (e.target.value || null) as AutoMatchRule['amountOperator'], amountValue: '', amountValue2: '' })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">Any amount</option>
            <option value="EXACT">Exactly</option>
            <option value="LT">Less than</option>
            <option value="LTE">Less than or equal</option>
            <option value="GT">Greater than</option>
            <option value="GTE">Greater than or equal</option>
            <option value="BETWEEN">Between</option>
          </select>

          {form.amountOperator && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={form.amountValue}
                onChange={(e) => onChange({ ...form, amountValue: e.target.value })}
                placeholder="0.00"
                className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
              />
              {form.amountOperator === 'BETWEEN' && (
                <>
                  <span className="text-xs text-gray-500">and $</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.amountValue2}
                    onChange={(e) => onChange({ ...form, amountValue2: e.target.value })}
                    placeholder="0.00"
                    className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RulesTab() {
  const { data: rules = [], isLoading } = useAutoMatchRules();
  const { data: billTemplates = [] } = useBillTemplates();
  const { data: incomeSources = [] } = useIncomeSources();
  const createRule = useCreateAutoMatchRule();
  const updateRule = useUpdateAutoMatchRule();
  const deleteRule = useDeleteAutoMatchRule();
  const applyRules = useApplyAutoMatchRules();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RuleForm>(emptyRuleForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RuleForm>(emptyRuleForm);
  const [applyResult, setApplyResult] = useState<{ total: number; matched: number } | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.pattern || !form.targetId) return;
    await createRule.mutateAsync({
      ...form,
      amountValue: form.amountValue ? parseFloat(form.amountValue) : null,
      amountValue2: form.amountValue2 ? parseFloat(form.amountValue2) : null,
    });
    setForm(emptyRuleForm);
    setShowForm(false);
    const result = await applyRules.mutateAsync();
    setApplyResult(result);
  }

  async function handleRunRules() {
    const result = await applyRules.mutateAsync();
    setApplyResult(result);
  }

  function startEdit(rule: AutoMatchRule) {
    setEditingId(rule.id);
    setEditForm({
      pattern: rule.pattern,
      matchType: rule.matchType,
      targetType: rule.targetType,
      targetId: rule.targetId,
      priority: rule.priority,
      amountOperator: rule.amountOperator,
      amountValue: rule.amountValue != null ? String(rule.amountValue) : '',
      amountValue2: rule.amountValue2 != null ? String(rule.amountValue2) : '',
    });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !editForm.pattern || !editForm.targetId) return;
    await updateRule.mutateAsync({
      id: editingId,
      ...editForm,
      amountValue: editForm.amountValue ? parseFloat(editForm.amountValue) : null,
      amountValue2: editForm.amountValue2 ? parseFloat(editForm.amountValue2) : null,
    });
    setEditingId(null);
  }

  return (
    <div className="h-full overflow-y-auto space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Rules are applied on import to automatically match transactions. Higher priority = evaluated first.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleRunRules}
            disabled={applyRules.isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50"
          >
            {applyRules.isPending ? 'Running…' : '▶ Run Rules'}
          </button>
          <button onClick={() => { setShowForm((v) => !v); setEditingId(null); }}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white">
            + Add Rule
          </button>
        </div>
      </div>

      {applyResult && (
        <div className="flex items-center justify-between bg-green-900/30 border border-green-700/50 rounded-lg px-4 py-2">
          <p className="text-sm text-green-300">
            Ran rules against {applyResult.total} unmatched transaction{applyResult.total !== 1 ? 's' : ''} —{' '}
            <span className="font-semibold">{applyResult.matched} matched</span>
          </p>
          <button onClick={() => setApplyResult(null)} className="text-green-600 hover:text-green-400 text-xs">✕</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
          <RuleFormFields form={form} onChange={setForm} billTemplates={billTemplates} incomeSources={incomeSources} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm">Cancel</button>
            <button type="submit" disabled={createRule.isPending} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50">
              {createRule.isPending ? 'Saving…' : 'Create Rule'}
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="text-sm text-gray-500 text-center py-8">Loading…</p>}
      {!isLoading && rules.length === 0 && !showForm && (
        <p className="text-sm text-gray-500 text-center py-8">No rules yet — add one to start auto-matching on import</p>
      )}

      <div className="space-y-2">
        {rules.map((rule) => {
          const target = rule.targetType === 'BILL'
            ? billTemplates.find((t) => t.id === rule.targetId)?.name
            : incomeSources.find((s) => s.id === rule.targetId)?.name;

          if (editingId === rule.id) {
            return (
              <form key={rule.id} onSubmit={handleSaveEdit}
                className="bg-gray-800/50 border border-blue-700 rounded-xl p-4 space-y-3">
                <p className="text-xs text-blue-400 font-medium">Editing rule</p>
                <RuleFormFields form={editForm} onChange={setEditForm} billTemplates={billTemplates} incomeSources={incomeSources} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm">Cancel</button>
                  <button type="submit" disabled={updateRule.isPending} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50">
                    {updateRule.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </form>
            );
          }

          return (
            <div key={rule.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${rule.isActive ? 'border-gray-700 bg-gray-800/30' : 'border-gray-800 bg-gray-900/30 opacity-50'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-mono">"{rule.pattern}"</span>
                  <span className="text-xs text-gray-500">{rule.matchType.replace('_', ' ').toLowerCase()}</span>
                  <span className="text-xs text-gray-600">→</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${rule.targetType === 'BILL' ? 'bg-red-900/40 text-red-300' : 'bg-green-900/40 text-green-300'}`}>
                    {rule.targetType === 'BILL' ? 'EXP' : 'INC'}
                  </span>
                  <span className="text-sm text-gray-300">{target ?? rule.targetId}</span>
                </div>
                <p className="text-xs text-gray-600 mt-0.5">
                  Priority {rule.priority}
                  {rule.amountOperator && (
                    <span className="ml-2 text-amber-400/70">
                      {rule.amountOperator === 'EXACT'   ? `= $${rule.amountValue}` :
                       rule.amountOperator === 'LT'      ? `< $${rule.amountValue}` :
                       rule.amountOperator === 'LTE'     ? `≤ $${rule.amountValue}` :
                       rule.amountOperator === 'GT'      ? `> $${rule.amountValue}` :
                       rule.amountOperator === 'GTE'     ? `≥ $${rule.amountValue}` :
                       rule.amountOperator === 'BETWEEN' ? `$${rule.amountValue}–$${rule.amountValue2}` : ''}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => updateRule.mutate({ id: rule.id, isActive: !rule.isActive })}
                className={`text-xs px-2 py-1 rounded ${rule.isActive ? 'bg-green-900/40 text-green-400 hover:bg-red-900/40 hover:text-red-400' : 'bg-gray-700 text-gray-500 hover:bg-green-900/40 hover:text-green-400'}`}
              >
                {rule.isActive ? 'Active' : 'Disabled'}
              </button>
              <button
                onClick={() => { setShowForm(false); startEdit(rule); }}
                className="text-xs text-gray-500 hover:text-blue-400"
              >Edit</button>
              <button
                onClick={() => { if (confirm('Delete this rule?')) deleteRule.mutate(rule.id); }}
                className="text-xs text-gray-600 hover:text-red-400"
              >Del</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [matchTarget, setMatchTarget] = useState<Transaction | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  }
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; matched: number; format: string } | null>(null);
  const [ruleCreated, setRuleCreated] = useState<{ pattern: string; targetName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importMutation = useImportTransactions();

  const { data: inboxData } = useTransactions({ status: 'UNMATCHED', limit: 1 });
  const unmatchedCount = inboxData?.total ?? 0;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importMutation.mutateAsync(file);
      setImportResult({ imported: result.importedCount, skipped: result.skippedCount, matched: result.matchedCount, format: result.format });
      setTab('inbox');
    } catch (err: any) {
      alert(`Import failed: ${err.response?.data?.error ?? err.message}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'inbox', label: 'Inbox', badge: unmatchedCount || undefined },
    { key: 'all', label: 'All Transactions' },
    { key: 'history', label: 'Import History' },
    { key: 'rules', label: 'Auto-Match Rules' },
  ];

  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Transactions</h2>
          <p className="text-xs text-gray-500 mt-0.5">Import bank statements, match to projected items, and reconcile</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowManual(true)} className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300">
            + Manual
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}
            className="text-sm px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white font-medium disabled:opacity-50">
            {importMutation.isPending ? 'Importing…' : '↑ Import OFX / CSV'}
          </button>
          <input ref={fileInputRef} type="file" accept=".ofx,.qfx,.csv" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {importResult && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-green-900/30 border border-green-800 rounded-lg text-sm">
          <span className="text-green-300">
            Import complete ({importResult.format}): <strong>{importResult.imported}</strong> imported,&nbsp;
            <strong>{importResult.matched}</strong> auto-matched,&nbsp;
            <strong>{importResult.skipped}</strong> skipped (duplicates)
          </span>
          <button onClick={() => setImportResult(null)} className="text-green-600 hover:text-green-300 text-xs">✕</button>
        </div>
      )}

      {ruleCreated && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-blue-900/30 border border-blue-800 rounded-lg text-sm">
          <span className="text-blue-300">
            Auto-match rule created: <strong>"{ruleCreated.pattern}"</strong> → <strong>{ruleCreated.targetName}</strong>
          </span>
          <button onClick={() => setRuleCreated(null)} className="text-blue-600 hover:text-blue-300 text-xs">✕</button>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex border-b border-gray-800">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
                tab === t.key ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}>
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span className="text-xs bg-blue-700 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-4 flex flex-col">
          {tab === 'inbox'   && <InboxTab onMatch={setMatchTarget} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />}
          {tab === 'all'     && <AllTab   onMatch={setMatchTarget} />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'rules'   && <RulesTab />}
        </div>
      </div>

      {matchTarget && (
        <MatchPicker
          transaction={matchTarget}
          onClose={() => setMatchTarget(null)}
          onRuleCreated={(pattern, targetName) => setRuleCreated({ pattern, targetName })}
        />
      )}
      {showManual && <ManualEntryModal onClose={() => setShowManual(false)} />}
    </div>
  );
}
