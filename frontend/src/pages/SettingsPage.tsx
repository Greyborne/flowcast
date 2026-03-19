import { useState, useEffect } from 'react';
import { useSettings, useSaveSettings, useRegeneratePeriods } from '../hooks/useSettings';

const FREQUENCY_OPTIONS = [
  { value: 'weekly',    label: 'Weekly' },
  { value: 'biweekly',  label: 'Bi-Weekly (every 2 weeks)' },
  { value: 'monthly',   label: 'Monthly' },
];

const PROJECTION_YEAR_OPTIONS = [
  { value: '1', label: '1 Year' },
  { value: '2', label: '2 Years' },
  { value: '3', label: '3 Years' },
];

export default function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const saveSettings = useSaveSettings();
  const regenerate = useRegeneratePeriods();

  const [form, setForm] = useState({
    currentBankBalance: '',
    payScheduleAnchor: '',
    payFrequency: 'biweekly',
    projectionYears: '2',
  });
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [regenResult, setRegenResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Populate form when settings load
  useEffect(() => {
    if (settings) {
      setForm({
        currentBankBalance: settings.currentBankBalance ?? '',
        payScheduleAnchor:  settings.payScheduleAnchor ?? '',
        payFrequency:       settings.payFrequency ?? 'biweekly',
        projectionYears:    settings.projectionYears ?? '2',
      });
    }
  }, [settings]);

  const handleSave = async () => {
    await saveSettings.mutateAsync(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleRegenerate = async () => {
    setShowRegenConfirm(false);
    setRegenResult(null);
    try {
      const result = await regenerate.mutateAsync();
      setRegenResult(`✓ ${result.message}`);
    } catch (err: any) {
      setRegenResult(`✗ ${err.response?.data?.error ?? 'Failed to regenerate periods'}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Settings</h2>
        <p className="text-sm text-gray-500 mt-1">Configure your pay schedule and projection preferences.</p>
      </div>

      {/* ── Pay Schedule ── */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Pay Schedule</h3>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Anchor Payday Date</label>
          <p className="text-xs text-gray-600">The first (or most recent) payday — the schedule is built from this date forward.</p>
          <input
            type="date"
            value={form.payScheduleAnchor}
            onChange={(e) => setForm({ ...form, payScheduleAnchor: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm w-full focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Pay Frequency</label>
          <select
            value={form.payFrequency}
            onChange={(e) => setForm({ ...form, payFrequency: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm w-full focus:outline-none focus:border-blue-500"
          >
            {FREQUENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Projection Window</label>
          <select
            value={form.projectionYears}
            onChange={(e) => setForm({ ...form, projectionYears: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm w-full focus:outline-none focus:border-blue-500"
          >
            {PROJECTION_YEAR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </section>

      {/* ── Balance ── */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Current Balance</h3>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Current Bank Balance</label>
          <p className="text-xs text-gray-600">Used as the opening balance when regenerating pay periods.</p>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.currentBankBalance}
              onChange={(e) => setForm({ ...form, currentBankBalance: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-3 py-2 text-white text-sm w-full focus:outline-none focus:border-blue-500"
              placeholder="0.00"
            />
          </div>
        </div>
      </section>

      {/* ── Save Button ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saveSettings.isPending}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saveSettings.isPending ? 'Saving...' : 'Save Settings'}
        </button>
        {saved && (
          <span className="text-sm text-green-400">Settings saved.</span>
        )}
      </div>

      {/* ── Regenerate Pay Periods ── */}
      <section className="bg-gray-900 rounded-xl border border-amber-800/40 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Regenerate Pay Periods</h3>
          <p className="text-sm text-gray-400 mt-1">
            Rebuilds the pay period schedule using the anchor date, frequency, and projection window above.
            Reconciled periods are never touched — only future unreconciled periods are affected.
          </p>
          <p className="text-xs text-gray-600 mt-1">
            Tip: Save your settings first, then regenerate.
          </p>
        </div>

        {!showRegenConfirm ? (
          <button
            onClick={() => setShowRegenConfirm(true)}
            className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Regenerate Pay Periods
          </button>
        ) : (
          <div className="flex items-center gap-3 bg-amber-900/30 border border-amber-700/50 rounded-lg px-4 py-3">
            <span className="text-sm text-amber-300">This will delete and rebuild all future unreconciled periods. Continue?</span>
            <button
              onClick={handleRegenerate}
              disabled={regenerate.isPending}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors"
            >
              {regenerate.isPending ? 'Working...' : 'Yes, Regenerate'}
            </button>
            <button
              onClick={() => setShowRegenConfirm(false)}
              className="text-xs text-gray-400 hover:text-white px-2 py-1"
            >
              Cancel
            </button>
          </div>
        )}

        {regenResult && (
          <p className={`text-sm ${regenResult.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
            {regenResult}
          </p>
        )}
      </section>
    </div>
  );
}
