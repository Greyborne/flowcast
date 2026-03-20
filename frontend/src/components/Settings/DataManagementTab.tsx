import { useState } from 'react';
import axios from 'axios';
import { useQueryClient } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

type ClearTarget = 'reconciliations' | 'instances' | 'snapshots' | 'templates' | 'sources' | 'periods';

interface Option {
  id: ClearTarget;
  label: string;
  description: string;
  severity: 'low' | 'high' | 'critical';
}

const OPTIONS: Option[] = [
  {
    id: 'reconciliations',
    label: 'Clear all reconciliations',
    description: 'Un-reconcile every bill and income entry. Actual amounts are discarded, projected amounts remain.',
    severity: 'low',
  },
  {
    id: 'snapshots',
    label: 'Clear balance history',
    description: 'Wipe all computed balance snapshots. They will recompute automatically on next load.',
    severity: 'low',
  },
  {
    id: 'instances',
    label: 'Clear all bill instances & income entries',
    description: 'Remove all projected rows from the grid. Templates and sources remain. Data regenerates on server restart.',
    severity: 'high',
  },
  {
    id: 'templates',
    label: 'Delete all bill templates',
    description: 'Permanently removes every bill template and all associated bill instances.',
    severity: 'high',
  },
  {
    id: 'sources',
    label: 'Delete all income sources',
    description: 'Permanently removes every income source and all associated income entries.',
    severity: 'high',
  },
  {
    id: 'periods',
    label: 'Delete all pay periods',
    description: 'Permanently removes the entire pay schedule and cascades to delete all instances, entries, and balances.',
    severity: 'critical',
  },
];

const SEVERITY_STYLES: Record<string, string> = {
  low:      'border-yellow-800/60 bg-yellow-950/20',
  high:     'border-orange-800/60 bg-orange-950/20',
  critical: 'border-red-800/60 bg-red-950/20',
};

const SEVERITY_CHECK: Record<string, string> = {
  low:      'accent-yellow-500',
  high:     'accent-orange-500',
  critical: 'accent-red-500',
};

const SEVERITY_BADGE: Record<string, string> = {
  low:      'text-yellow-500 bg-yellow-950/50 border-yellow-700/50',
  high:     'text-orange-400 bg-orange-950/50 border-orange-700/50',
  critical: 'text-red-400 bg-red-950/50 border-red-700/50',
};

export default function DataManagementTab() {
  const qc = useQueryClient();
  const [selected,    setSelected]    = useState<Set<ClearTarget>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [saving,      setSaving]      = useState(false);
  const [result,      setResult]      = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  const toggle = (id: ClearTarget) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectAll = () => setSelected(new Set(OPTIONS.map((o) => o.id)));
  const clearAll  = () => setSelected(new Set());

  const hasCritical = [...selected].some((id) => OPTIONS.find((o) => o.id === id)?.severity === 'critical');
  const confirmPhrase = 'DELETE MY DATA';

  const canConfirm = selected.size > 0 && (hasCritical ? confirmText === confirmPhrase : true);

  const handleClear = async () => {
    setSaving(true);
    setResult(null);
    setError(null);
    try {
      const { data } = await axios.post(`${API}/api/admin/clear`, { targets: [...selected] });
      const parts: string[] = [];
      if (data.summary.billsUnreconciled)     parts.push(`${data.summary.billsUnreconciled} bills un-reconciled`);
      if (data.summary.incomeUnreconciled)    parts.push(`${data.summary.incomeUnreconciled} income entries un-reconciled`);
      if (data.summary.logsDeleted)           parts.push(`${data.summary.logsDeleted} reconciliation logs cleared`);
      if (data.summary.instancesDeleted)      parts.push(`${data.summary.instancesDeleted} bill instances deleted`);
      if (data.summary.entriesDeleted)        parts.push(`${data.summary.entriesDeleted} income entries deleted`);
      if (data.summary.snapshotsDeleted)      parts.push(`${data.summary.snapshotsDeleted} snapshots cleared`);
      if (data.summary.templatesDeleted)      parts.push(`${data.summary.templatesDeleted} bill templates deleted`);
      if (data.summary.sourcesDeleted)        parts.push(`${data.summary.sourcesDeleted} income sources deleted`);
      if (data.summary.periodsDeleted)        parts.push(`${data.summary.periodsDeleted} pay periods deleted`);
      setResult(parts.length ? parts.join(', ') + '.' : 'Done — nothing to clear.');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['payPeriods'] }),
        qc.invalidateQueries({ queryKey: ['billGrid'] }),
        qc.invalidateQueries({ queryKey: ['incomeGrid'] }),
        qc.invalidateQueries({ queryKey: ['incomeSources'] }),
      ]);
      setSelected(new Set());
      setShowConfirm(false);
      setConfirmText('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Operation failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-400">
          Selectively clear portions of your data. Each operation is described below — read carefully before proceeding.
        </p>
      </div>

      {/* Options */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={selectAll} className="text-xs text-gray-500 hover:text-white transition-colors">Select all</button>
          <span className="text-gray-700">·</span>
          <button onClick={clearAll}  className="text-xs text-gray-500 hover:text-white transition-colors">Deselect all</button>
          {selected.size > 0 && (
            <span className="ml-auto text-xs text-gray-500">{selected.size} operation{selected.size !== 1 ? 's' : ''} selected</span>
          )}
        </div>

        {OPTIONS.map((opt) => (
          <label
            key={opt.id}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              selected.has(opt.id)
                ? SEVERITY_STYLES[opt.severity]
                : 'border-gray-800 bg-gray-900/40 hover:bg-gray-800/30'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(opt.id)}
              onChange={() => toggle(opt.id)}
              className={`mt-0.5 shrink-0 ${SEVERITY_CHECK[opt.severity]}`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-white font-medium">{opt.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wide ${SEVERITY_BADGE[opt.severity]}`}>
                  {opt.severity}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Action button */}
      {result && (
        <div className="p-3 rounded-lg bg-green-950/40 border border-green-800/50 text-xs text-green-300">
          ✓ {result}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-xs text-red-300">
          ✕ {error}
        </div>
      )}

      <div>
        <button
          onClick={() => { setShowConfirm(true); setConfirmText(''); setResult(null); setError(null); }}
          disabled={selected.size === 0}
          className="px-4 py-2 bg-red-800 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors font-medium"
        >
          Clear Selected Data
        </button>
      </div>

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => !saving && setShowConfirm(false)}>
          <div
            className="w-[440px] bg-gray-950 border border-red-900/60 rounded-xl shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-lg font-bold text-red-400">Confirm Data Deletion</h3>
              <p className="text-xs text-gray-500 mt-1">This cannot be undone. The following will be permanently affected:</p>
            </div>

            <ul className="space-y-1">
              {[...selected].map((id) => {
                const opt = OPTIONS.find((o) => o.id === id)!;
                return (
                  <li key={id} className="flex items-start gap-2 text-xs text-gray-300">
                    <span className={`shrink-0 mt-0.5 ${opt.severity === 'critical' ? 'text-red-400' : opt.severity === 'high' ? 'text-orange-400' : 'text-yellow-500'}`}>▸</span>
                    {opt.label}
                  </li>
                );
              })}
            </ul>

            {hasCritical && (
              <div className="space-y-1.5">
                <p className="text-xs text-red-400 font-medium">
                  This includes a critical operation. Type <span className="font-mono bg-red-950/60 px-1 rounded">{confirmPhrase}</span> to confirm:
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={confirmPhrase}
                  disabled={saving}
                  className="w-full bg-gray-900 border border-gray-700 focus:border-red-600 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none"
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleClear}
                disabled={!canConfirm || saving}
                className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {saving ? 'Clearing…' : 'Yes, delete this data'}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={saving}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
