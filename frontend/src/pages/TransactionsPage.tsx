import { useState, useRef } from 'react';
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
  useCreateManualTransaction,
} from '../hooks/useTransactions';
import { useBillTemplates } from '../hooks/useTemplates';
import { useIncomeSources } from '../hooks/useTemplates';
import type { Transaction, AutoMatchRule } from '../types';

type Tab = 'inbox' | 'all' | 'history' | 'rules';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ── Match Picker Modal ────────────────────────────────────────────────────────

function MatchPicker({
  transaction,
  onClose,
}: {
  transaction: Transaction;
  onClose: () => void;
}) {
  const { data: candidates, isLoading } = useMatchCandidates(transaction.id);
  const matchMutation = useMatchTransaction();

  async function handleMatch(billInstanceId?: string, incomeEntryId?: string) {
    await matchMutation.mutateAsync({ id: transaction.id, billInstanceId, incomeEntryId });
    onClose();
  }

  const hasBills = (candidates?.bills?.length ?? 0) > 0;
  const hasIncome = (candidates?.income?.length ?? 0) > 0;
  const hasAny = hasBills || hasIncome;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">Match Transaction</h3>
            <p className="text-xs text-gray-400 mt-0.5">{transaction.description}</p>
            <p className="text-sm font-mono font-semibold mt-1 text-white">{fmt.format(Math.abs(transaction.amount))}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        {isLoading && <p className="text-sm text-gray-400 text-center py-4">Finding candidates…</p>}

        {!isLoading && !hasAny && (
          <p className="text-sm text-gray-500 text-center py-4">
            No unreconciled items found within ±14 days of this transaction.
          </p>
        )}

        {!isLoading && hasBills && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Bills</p>
            <div className="space-y-1">
              {candidates!.bills.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleMatch(b.id, undefined)}
                  disabled={matchMutation.isPending}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-left text-sm transition-colors"
                >
                  <span className="text-gray-200 font-medium">{b.templateName}</span>
                  <div className="text-right">
                    <span className="text-gray-300">{fmt.format(b.projectedAmount)}</span>
                    <p className="text-xs text-gray-500">{fmtDate(b.paydayDate)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {!isLoading && hasIncome && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Income</p>
            <div className="space-y-1">
              {candidates!.income.map((e) => (
                <button
                  key={e.id}
                  onClick={() => handleMatch(undefined, e.id)}
                  disabled={matchMutation.isPending}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-left text-sm transition-colors"
                >
                  <span className="text-gray-200 font-medium">{e.sourceName}</span>
                  <div className="text-right">
                    <span className="text-gray-300">{fmt.format(e.projectedAmount)}</span>
                    <p className="text-xs text-gray-500">{fmtDate(e.paydayDate)}</p>
                  </div>
                </button>
              ))}
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
}: {
  txn: Transaction;
  onMatch: (txn: Transaction) => void;
}) {
  const unmatch = useUnmatchTransaction();
  const ignore = useIgnoreTransaction();
  const deleteTxn = useDeleteTransaction();
  const isExpense = txn.amount < 0;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-800 last:border-0 group">
      {/* Date */}
      <span className="text-xs text-gray-500 w-20 shrink-0">{fmtDate(txn.date)}</span>

      {/* Description */}
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

      {/* Source badge */}
      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 shrink-0">{txn.source}</span>

      {/* Amount */}
      <span className={`text-sm font-mono font-semibold w-20 text-right shrink-0 ${isExpense ? 'text-red-400' : 'text-green-400'}`}>
        {isExpense ? '-' : '+'}{fmt.format(Math.abs(txn.amount))}
      </span>

      {/* Status / Actions */}
      <div className="w-28 flex items-center justify-end gap-1.5 shrink-0">
        {txn.status === 'UNMATCHED' && (
          <>
            <button
              onClick={() => onMatch(txn)}
              className="text-xs px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white"
            >Match</button>
            <button
              onClick={() => ignore.mutate({ id: txn.id, ignore: true })}
              disabled={ignore.isPending}
              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
            >Ignore</button>
          </>
        )}
        {txn.status === 'MATCHED' && (
          <button
            onClick={() => unmatch.mutate(txn.id)}
            disabled={unmatch.isPending}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-red-300"
          >Unmatch</button>
        )}
        {txn.status === 'IGNORED' && (
          <button
            onClick={() => ignore.mutate({ id: txn.id, ignore: false })}
            disabled={ignore.isPending}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-400"
          >Restore</button>
        )}
        {txn.source === 'MANUAL' && (
          <button
            onClick={() => deleteTxn.mutate(txn.id)}
            disabled={deleteTxn.isPending}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-red-900 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100"
          >Del</button>
        )}
      </div>
    </div>
  );
}

// ── Inbox Tab ─────────────────────────────────────────────────────────────────

function InboxTab({ onMatch }: { onMatch: (txn: Transaction) => void }) {
  const { data, isLoading } = useTransactions({ status: 'UNMATCHED', limit: 200 });
  const transactions = data?.transactions ?? [];

  return (
    <div>
      {isLoading && <p className="text-sm text-gray-500 text-center py-8">Loading…</p>}
      {!isLoading && transactions.length === 0 && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">✓</p>
          <p className="text-gray-400 font-medium">Inbox zero — all transactions matched or ignored</p>
        </div>
      )}
      {transactions.map((t) => (
        <TransactionRow key={t.id} txn={t} onMatch={onMatch} />
      ))}
      {(data?.total ?? 0) > 200 && (
        <p className="text-xs text-gray-500 text-center pt-3">Showing first 200 of {data!.total}</p>
      )}
    </div>
  );
}

// ── All Transactions Tab ──────────────────────────────────────────────────────

function AllTab({ onMatch }: { onMatch: (txn: Transaction) => void }) {
  const [statusFilter, setStatusFilter] = useState('');
  const { data, isLoading } = useTransactions({ status: statusFilter || undefined, limit: 500 });
  const transactions = data?.transactions ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-gray-400">Filter:</span>
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
        <span className="ml-auto text-xs text-gray-600">{data?.total ?? 0} total</span>
      </div>
      {isLoading && <p className="text-sm text-gray-500 text-center py-8">Loading…</p>}
      {!isLoading && transactions.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-8">No transactions found</p>
      )}
      {transactions.map((t) => (
        <TransactionRow key={t.id} txn={t} onMatch={onMatch} />
      ))}
    </div>
  );
}

// ── Import History Tab ────────────────────────────────────────────────────────

function HistoryTab() {
  const { data: batches = [], isLoading } = useImportBatches();
  const deleteBatch = useDeleteImportBatch();

  return (
    <div>
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
            <div>
              <p className="text-gray-400 font-medium">{b.importedCount}</p>
              <p className="text-gray-600">imported</p>
            </div>
            <div>
              <p className="text-yellow-400 font-medium">{b.skippedCount}</p>
              <p className="text-gray-600">skipped</p>
            </div>
            <div>
              <p className="text-green-400 font-medium">{b.matchedCount}</p>
              <p className="text-gray-600">matched</p>
            </div>
          </div>
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 shrink-0">{b.format}</span>
          <button
            onClick={() => {
              if (confirm(`Delete import "${b.filename}"? This will un-reconcile any matched transactions.`)) {
                deleteBatch.mutate(b.id);
              }
            }}
            disabled={deleteBatch.isPending}
            className="text-xs text-gray-600 hover:text-red-400 shrink-0"
          >Delete</button>
        </div>
      ))}
    </div>
  );
}

// ── Auto Match Rules Tab ──────────────────────────────────────────────────────

function RulesTab() {
  const { data: rules = [], isLoading } = useAutoMatchRules();
  const { data: billTemplates = [] } = useBillTemplates();
  const { data: incomeSources = [] } = useIncomeSources();
  const createRule = useCreateAutoMatchRule();
  const updateRule = useUpdateAutoMatchRule();
  const deleteRule = useDeleteAutoMatchRule();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    pattern: '',
    matchType: 'CONTAINS' as AutoMatchRule['matchType'],
    targetType: 'BILL' as AutoMatchRule['targetType'],
    targetId: '',
    priority: 0,
  });

  const targetOptions = form.targetType === 'BILL'
    ? billTemplates.map((t) => ({ id: t.id, name: t.name }))
    : incomeSources.map((s) => ({ id: s.id, name: s.name }));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.pattern || !form.targetId) return;
    await createRule.mutateAsync(form);
    setForm({ pattern: '', matchType: 'CONTAINS', targetType: 'BILL', targetId: '', priority: 0 });
    setShowForm(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Rules are applied on import to automatically match transactions. Higher priority = evaluated first.
        </p>
        <button onClick={() => setShowForm((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white">
          + Add Rule
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Pattern</label>
              <input type="text" value={form.pattern} onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))}
                placeholder="WALMART" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" required />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Match Type</label>
              <select value={form.matchType} onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value as AutoMatchRule['matchType'] }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="CONTAINS">Contains</option>
                <option value="STARTS_WITH">Starts With</option>
                <option value="REGEX">Regex</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Target Type</label>
              <select value={form.targetType} onChange={(e) => setForm((f) => ({ ...f, targetType: e.target.value as AutoMatchRule['targetType'], targetId: '' }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="BILL">Bill Template</option>
                <option value="INCOME">Income Source</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Target</label>
              <select value={form.targetId} onChange={(e) => setForm((f) => ({ ...f, targetId: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" required>
                <option value="">Select…</option>
                {targetOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Priority (higher = first)</label>
              <input type="number" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono" />
            </div>
          </div>
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
          return (
            <div key={rule.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${rule.isActive ? 'border-gray-700 bg-gray-800/30' : 'border-gray-800 bg-gray-900/30 opacity-50'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-mono">"{rule.pattern}"</span>
                  <span className="text-xs text-gray-500">{rule.matchType.replace('_', ' ').toLowerCase()}</span>
                  <span className="text-xs text-gray-600">→</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${rule.targetType === 'BILL' ? 'bg-red-900/40 text-red-300' : 'bg-green-900/40 text-green-300'}`}>
                    {rule.targetType}
                  </span>
                  <span className="text-sm text-gray-300">{target ?? rule.targetId}</span>
                </div>
                <p className="text-xs text-gray-600 mt-0.5">Priority {rule.priority}</p>
              </div>
              <button
                onClick={() => updateRule.mutate({ id: rule.id, isActive: !rule.isActive })}
                className={`text-xs px-2 py-1 rounded ${rule.isActive ? 'bg-green-900/40 text-green-400 hover:bg-red-900/40 hover:text-red-400' : 'bg-gray-700 text-gray-500 hover:bg-green-900/40 hover:text-green-400'}`}
              >
                {rule.isActive ? 'Active' : 'Disabled'}
              </button>
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
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; matched: number; format: string } | null>(null);
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
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Transactions</h2>
          <p className="text-xs text-gray-500 mt-0.5">Import bank statements, match to projected items, and reconcile</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowManual(true)}
            className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300"
          >
            + Manual
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
            className="text-sm px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white font-medium disabled:opacity-50"
          >
            {importMutation.isPending ? 'Importing…' : '↑ Import OFX / CSV'}
          </button>
          <input ref={fileInputRef} type="file" accept=".ofx,.qfx,.csv" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {/* Import result banner */}
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

      {/* Tabs + Content */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex border-b border-gray-800">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span className="text-xs bg-blue-700 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="p-4">
          {tab === 'inbox' && <InboxTab onMatch={setMatchTarget} />}
          {tab === 'all' && <AllTab onMatch={setMatchTarget} />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'rules' && <RulesTab />}
        </div>
      </div>

      {matchTarget && <MatchPicker transaction={matchTarget} onClose={() => setMatchTarget(null)} />}
      {showManual && <ManualEntryModal onClose={() => setShowManual(false)} />}
    </div>
  );
}
