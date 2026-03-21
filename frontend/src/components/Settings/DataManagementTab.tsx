import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { useSettings } from '../../hooks/useSettings';

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
    label: 'Delete all expenses',
    description: 'Permanently removes every expense template and all associated instances.',
    severity: 'high',
  },
  {
    id: 'sources',
    label: 'Delete all income',
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
  low: 'accent-yellow-500', high: 'accent-orange-500', critical: 'accent-red-500',
};
const SEVERITY_BADGE: Record<string, string> = {
  low:      'text-yellow-500 bg-yellow-950/50 border-yellow-700/50',
  high:     'text-orange-400 bg-orange-950/50 border-orange-700/50',
  critical: 'text-red-400 bg-red-950/50 border-red-700/50',
};

const FREQUENCY_OPTIONS = [
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly (every 2 weeks)' },
  { value: 'monthly',  label: 'Monthly' },
];
const PROJECTION_YEAR_OPTIONS = [
  { value: '1', label: '1 Year' },
  { value: '2', label: '2 Years' },
  { value: '3', label: '3 Years' },
];

// ── Backup / Restore ──────────────────────────────────────────────────────────

type RestoreMode = 'merge' | 'replace';

interface BackupMeta {
  schemaVersion: number;
  createdAt: string;
  counts: { billTemplates: number; incomeSources: number; autoMatchRules: number; appSettings: number };
  data: unknown;
}

function BackupSection() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [downloading, setDownloading] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<BackupMeta | null>(null);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('merge');
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    try {
      const { data } = await axios.get(`${API}/api/backup`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flowcast-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError('Download failed: ' + (err.message ?? 'unknown error'));
    } finally {
      setDownloading(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as BackupMeta;
        if (!parsed.schemaVersion || !parsed.data) throw new Error('Invalid backup file');
        setPendingBackup(parsed);
        setResult(null);
        setError(null);
        setWarning(null);
      } catch {
        setError('Could not parse backup file — make sure it is a valid FlowCast backup.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleRestore() {
    if (!pendingBackup) return;
    setRestoring(true);
    setError(null);
    try {
      const { data } = await axios.post(`${API}/api/backup/restore`, {
        mode: restoreMode,
        backup: pendingBackup,
      });
      const s = data.summary;
      setResult(
        `Restored: ${s.billTemplates} expenses, ${s.incomeSources} income sources, ` +
        `${s.autoMatchRules} rules, ${s.appSettings} settings.`
      );
      setWarning(data.versionWarning ?? null);
      setPendingBackup(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['billTemplates'] }),
        qc.invalidateQueries({ queryKey: ['incomeSources'] }),
        qc.invalidateQueries({ queryKey: ['autoMatchRules'] }),
        qc.invalidateQueries({ queryKey: ['settings'] }),
      ]);
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Restore failed');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">Backup & Restore</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Export your expenses, income sources, auto-match rules, and settings to a JSON file.
          Restore from a previous backup with Merge (safe, non-destructive) or Replace (wipe and reimport).
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="px-4 py-2 bg-blue-800 hover:bg-blue-700 disabled:opacity-40 text-white text-sm rounded-lg transition-colors font-medium"
        >
          {downloading ? 'Preparing…' : '↓ Download Backup'}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors border border-gray-700"
        >
          ↑ Load Backup File…
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFileSelect} />
      </div>

      {/* Restore confirmation panel */}
      {pendingBackup && (
        <div className="border border-blue-800/60 bg-blue-950/20 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-blue-300">Backup loaded</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Created {new Date(pendingBackup.createdAt).toLocaleString()} · schema v{pendingBackup.schemaVersion}
              </p>
            </div>
            <button onClick={() => setPendingBackup(null)} className="text-gray-600 hover:text-gray-400 text-xs shrink-0">✕</button>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            {Object.entries(pendingBackup.counts).map(([key, count]) => (
              <div key={key} className="bg-gray-800/60 rounded-lg px-2 py-2">
                <p className="text-sm font-semibold text-white">{count}</p>
                <p className="text-[10px] text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-gray-400 font-medium">Restore mode</p>
            <div className="flex gap-3">
              {(['merge', 'replace'] as RestoreMode[]).map((m) => (
                <label key={m} className={`flex-1 flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                  restoreMode === m ? 'border-blue-600 bg-blue-900/20' : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
                }`}>
                  <input type="radio" name="restoreMode" value={m} checked={restoreMode === m}
                    onChange={() => setRestoreMode(m)} className="mt-0.5 accent-blue-500 shrink-0" />
                  <div>
                    <p className="text-sm text-white font-medium capitalize">{m}</p>
                    <p className="text-xs text-gray-500">
                      {m === 'merge'
                        ? 'Add missing records, update existing ones by name. Safe to run on a live database.'
                        : 'Wipe expenses, income, and rules then reimport clean. Use after a reseed.'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {restoreMode === 'replace' && (
            <p className="text-xs text-orange-400 bg-orange-950/30 border border-orange-800/40 rounded px-3 py-2">
              Replace mode will delete all current expenses, income sources, and rules before restoring.
              Pay periods and transactions are not affected.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {restoring ? 'Restoring…' : `Restore (${restoreMode})`}
            </button>
            <button onClick={() => setPendingBackup(null)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {warning && (
        <p className="text-xs text-yellow-400 bg-yellow-950/30 border border-yellow-800/40 rounded px-3 py-2">
          ⚠ {warning}
        </p>
      )}
      {result && (
        <p className="text-xs text-green-300 bg-green-950/30 border border-green-800/40 rounded px-3 py-2">
          ✓ {result}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded px-3 py-2">
          ✕ {error}
        </p>
      )}
    </div>
  );
}

// ── Regenerate modal ──────────────────────────────────────────────────────────

function RegenerateModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const { data: settings } = useSettings();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    currentBankBalance: '',
    payScheduleAnchor:  '',
    payFrequency:       'biweekly',
    projectionYears:    '2',
  });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Pre-fill from current settings once loaded
  useEffect(() => {
    if (settings) {
      setForm({
        currentBankBalance: settings.currentBankBalance ?? '',
        payScheduleAnchor:  settings.payScheduleAnchor  ?? '',
        payFrequency:       settings.payFrequency        ?? 'biweekly',
        projectionYears:    settings.projectionYears     ?? '2',
      });
    }
  }, [settings]);

  const handleRegenerate = async () => {
    if (!form.payScheduleAnchor) { setError('Anchor payday date is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      // Save settings first, then regenerate
      await axios.put(`${API}/api/settings`, form);
      const { data } = await axios.post(`${API}/api/settings/regenerate-periods`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['payPeriods'] }),
        qc.invalidateQueries({ queryKey: ['billGrid'] }),
        qc.invalidateQueries({ queryKey: ['incomeGrid'] }),
        qc.invalidateQueries({ queryKey: ['settings'] }),
      ]);
      onDone(data.message ?? 'Pay periods regenerated.');
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Regeneration failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => !saving && onClose()}>
      <div
        className="w-[460px] bg-gray-950 border border-blue-900/60 rounded-xl shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div>
          <h3 className="text-lg font-bold text-white">Regenerate Pay Schedule</h3>
          <p className="text-xs text-gray-500 mt-1">
            Review and adjust your schedule settings. Your expenses and income
            will be used to populate the new periods.
          </p>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm text-gray-400">
              Anchor Payday Date <span className="text-red-400">*</span>
            </label>
            <p className="text-xs text-gray-600">Your first (or most recent) payday — the schedule builds forward from here.</p>
            <input
              type="date"
              value={form.payScheduleAnchor}
              onChange={(e) => setForm({ ...form, payScheduleAnchor: e.target.value })}
              disabled={saving}
              className="w-full bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm text-gray-400">Pay Frequency</label>
              <select
                value={form.payFrequency}
                onChange={(e) => setForm({ ...form, payFrequency: e.target.value })}
                disabled={saving}
                className="w-full bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
              >
                {FREQUENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-gray-400">Projection Window</label>
              <select
                value={form.projectionYears}
                onChange={(e) => setForm({ ...form, projectionYears: e.target.value })}
                disabled={saving}
                className="w-full bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
              >
                {PROJECTION_YEAR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm text-gray-400">Opening Bank Balance</label>
            <p className="text-xs text-gray-600">Current balance in your account — used as the starting point for projections.</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={form.currentBankBalance}
                onChange={(e) => setForm({ ...form, currentBankBalance: e.target.value })}
                disabled={saving}
                placeholder="0.00"
                className="w-full bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg pl-7 pr-3 py-2 text-white text-sm focus:outline-none"
              />
            </div>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded px-3 py-2">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleRegenerate}
            disabled={saving || !form.payScheduleAnchor}
            className="flex-1 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {saving ? 'Saving & regenerating…' : 'Save & Regenerate'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function DataManagementTab() {
  const qc = useQueryClient();
  const [selected,        setSelected]        = useState<Set<ClearTarget>>(new Set());
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [showRegenerate,  setShowRegenerate]  = useState(false);
  const [confirmText,     setConfirmText]     = useState('');
  const [saving,          setSaving]          = useState(false);
  const [result,          setResult]          = useState<string | null>(null);
  const [regenResult,     setRegenResult]     = useState<string | null>(null);
  const [error,           setError]           = useState<string | null>(null);
  const [clearedPeriods,  setClearedPeriods]  = useState(false);

  const toggle = (id: ClearTarget) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectAll = () => setSelected(new Set(OPTIONS.map((o) => o.id)));
  const clearAll  = () => setSelected(new Set());

  const hasCritical   = [...selected].some((id) => OPTIONS.find((o) => o.id === id)?.severity === 'critical');
  const confirmPhrase = 'DELETE MY DATA';
  const canConfirm    = selected.size > 0 && (hasCritical ? confirmText === confirmPhrase : true);

  const handleClear = async () => {
    setSaving(true);
    setResult(null);
    setError(null);
    const includedPeriods = selected.has('periods');
    try {
      const { data } = await axios.post(`${API}/api/admin/clear`, { targets: [...selected] });
      const parts: string[] = [];
      if (data.summary.billsUnreconciled)  parts.push(`${data.summary.billsUnreconciled} bills un-reconciled`);
      if (data.summary.incomeUnreconciled) parts.push(`${data.summary.incomeUnreconciled} income entries un-reconciled`);
      if (data.summary.logsDeleted)        parts.push(`${data.summary.logsDeleted} reconciliation logs cleared`);
      if (data.summary.instancesDeleted)   parts.push(`${data.summary.instancesDeleted} bill instances deleted`);
      if (data.summary.entriesDeleted)     parts.push(`${data.summary.entriesDeleted} income entries deleted`);
      if (data.summary.snapshotsDeleted)   parts.push(`${data.summary.snapshotsDeleted} snapshots cleared`);
      if (data.summary.templatesDeleted)   parts.push(`${data.summary.templatesDeleted} expenses deleted`);
      if (data.summary.sourcesDeleted)     parts.push(`${data.summary.sourcesDeleted} income deleted`);
      if (data.summary.periodsDeleted)     parts.push(`${data.summary.periodsDeleted} pay periods deleted`);
      setResult(parts.length ? parts.join(', ') + '.' : 'Done — nothing to clear.');
      setClearedPeriods(includedPeriods);
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
      <BackupSection />

      <div className="border-t border-gray-800 pt-6">
        <p className="text-sm text-gray-400 mb-4">
          Selectively clear portions of your data. Each operation is described below — read carefully before proceeding.
        </p>

      {/* ── Clear options ── */}
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
              selected.has(opt.id) ? SEVERITY_STYLES[opt.severity] : 'border-gray-800 bg-gray-900/40 hover:bg-gray-800/30'
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

      {/* ── Results ── */}
      {result && (
        <div className="p-3 rounded-lg bg-green-950/40 border border-green-800/50 space-y-2">
          <p className="text-xs text-green-300">✓ {result}</p>
          {clearedPeriods && (
            <div className="flex items-center gap-3 pt-1 border-t border-green-900/40">
              <p className="text-xs text-blue-300 flex-1">Pay periods were deleted. Ready to rebuild your schedule?</p>
              <button
                onClick={() => { setShowRegenerate(true); setRegenResult(null); }}
                className="shrink-0 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Regenerate Now →
              </button>
            </div>
          )}
        </div>
      )}
      {regenResult && (
        <div className="p-3 rounded-lg bg-blue-950/40 border border-blue-800/50 text-xs text-blue-300">
          ✓ {regenResult}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-xs text-red-300">
          ✕ {error}
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setShowConfirm(true); setConfirmText(''); setResult(null); setError(null); setClearedPeriods(false); setRegenResult(null); }}
          disabled={selected.size === 0}
          className="px-4 py-2 bg-red-800 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors font-medium"
        >
          Clear Selected Data
        </button>
        <span className="text-gray-700">·</span>
        <button
          onClick={() => { setShowRegenerate(true); setRegenResult(null); }}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-blue-400 hover:text-blue-300 text-sm rounded-lg transition-colors border border-gray-700"
        >
          Regenerate Projections
        </button>
      </div>

      {/* ── Delete confirmation modal ── */}
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

      {/* ── Regenerate modal ── */}
      {showRegenerate && (
        <RegenerateModal
          onClose={() => setShowRegenerate(false)}
          onDone={(msg) => setRegenResult(msg)}
        />
      )}
      </div>
    </div>
  );
}
