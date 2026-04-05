import { useState } from 'react';
import { useAccount, ACCOUNT_COLORS } from '../../context/AccountContext';
import api from '../../lib/api';
import type { AccountColor, PeriodType } from '../../types';

interface Props {
  onClose: () => void;
  onCreated: (accountId: string) => void;
}

const COLOR_OPTIONS: { value: AccountColor; label: string }[] = [
  { value: 'blue',   label: 'Blue' },
  { value: 'green',  label: 'Green' },
  { value: 'purple', label: 'Purple' },
  { value: 'amber',  label: 'Amber' },
  { value: 'rose',   label: 'Rose' },
  { value: 'teal',   label: 'Teal' },
];

type Step = 'identity' | 'schedule' | 'opening';

export default function NewAccountWizard({ onClose, onCreated }: Props) {
  const { createAccount } = useAccount();

  // Step 1
  const [name, setName]   = useState('');
  const [color, setColor] = useState<AccountColor>('green');

  // Step 2
  const [periodType, setPeriodType] = useState<PeriodType>('biweekly');
  const [anchorDate, setAnchorDate] = useState('');

  // Step 3
  const [openingBalance, setOpeningBalance] = useState('');

  const [step, setStep]     = useState<Step>('identity');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // ── Navigation ───────────────────────────────────────────────────────────────
  function nextStep() {
    setError('');
    if (step === 'identity') {
      if (!name.trim()) { setError('Please enter an account name.'); return; }
      setStep('schedule');
    } else if (step === 'schedule') {
      if (!anchorDate) { setError('Please pick an anchor date.'); return; }
      setStep('opening');
    }
  }

  function prevStep() {
    setError('');
    if (step === 'schedule') setStep('identity');
    if (step === 'opening')  setStep('schedule');
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleCreate() {
    if (!openingBalance) { setError('Please enter an opening balance.'); return; }
    setSaving(true);
    setError('');
    try {
      const account = await createAccount({ name: name.trim(), color, periodType });

      // Set anchor + opening balance for new account
      // Temporarily write the new account ID to localStorage so api interceptor uses it
      const prevId = localStorage.getItem('activeAccountId') || 'personal';
      localStorage.setItem('activeAccountId', account.id);

      await api.put('/api/settings', {
        payScheduleAnchor: anchorDate,
        currentBankBalance: openingBalance,
        payFrequency: periodType === 'biweekly' ? 'biweekly' : 'monthly',
        projectionYears: '2',
      });

      // Regenerate periods for the new account
      await api.post('/api/settings/regenerate-periods');

      // Restore previous account in localStorage — switchAccount will set the new one
      localStorage.setItem('activeAccountId', prevId);

      onCreated(account.id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create account.';
      setError(msg);
      setSaving(false);
    }
  }

  // ── Step labels ──────────────────────────────────────────────────────────────
  const STEPS: Step[] = ['identity', 'schedule', 'opening'];
  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        {/* ── Header ── */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">New Account</h2>
          <p className="text-sm text-gray-400 mt-0.5">Step {stepIdx + 1} of 3</p>
          {/* Progress bar */}
          <div className="mt-3 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${((stepIdx + 1) / 3) * 100}%` }}
            />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-6 py-5 space-y-4">

          {/* Step 1: Name + Color */}
          {step === 'identity' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Account Name</label>
                <input
                  autoFocus
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && nextStep()}
                  placeholder="e.g. Business Checking"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLOR_OPTIONS.map(({ value, label }) => {
                    const c = ACCOUNT_COLORS[value];
                    return (
                      <button
                        key={value}
                        title={label}
                        onClick={() => setColor(value)}
                        className={`w-8 h-8 rounded-full ${c.dot} transition-all ${
                          color === value ? 'ring-2 ring-offset-2 ring-offset-gray-900 ring-white scale-110' : 'opacity-60 hover:opacity-100'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Step 2: Period type + anchor */}
          {step === 'schedule' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Pay Schedule</label>
                <div className="flex gap-3">
                  {(['biweekly', 'monthly'] as PeriodType[]).map((pt) => (
                    <button
                      key={pt}
                      onClick={() => setPeriodType(pt)}
                      className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                        periodType === pt
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                      }`}
                    >
                      {pt === 'biweekly' ? 'Bi-Weekly' : 'Monthly'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {periodType === 'biweekly'
                    ? 'Pay periods run every two weeks from your anchor payday.'
                    : 'Pay periods run from the 1st to the last day of each month.'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  {periodType === 'biweekly' ? 'First Payday (anchor date)' : 'Starting Month (any day in that month)'}
                </label>
                <input
                  type="date"
                  value={anchorDate}
                  onChange={(e) => setAnchorDate(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
            </>
          )}

          {/* Step 3: Opening balance */}
          {step === 'opening' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Opening Bank Balance</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    autoFocus
                    type="number"
                    step="0.01"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    placeholder="0.00"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1.5">Current balance in this account as of today.</p>
              </div>

              {/* Summary */}
              <div className="bg-gray-800/60 rounded-lg px-4 py-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-400">
                  <span>Name</span><span className="text-white font-medium">{name}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Schedule</span><span className="text-white font-medium capitalize">{periodType}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Anchor</span><span className="text-white font-medium">{anchorDate}</span>
                </div>
              </div>
            </>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={stepIdx === 0 ? onClose : prevStep}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            {stepIdx === 0 ? 'Cancel' : '← Back'}
          </button>

          {step !== 'opening' ? (
            <button
              onClick={nextStep}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? 'Creating…' : 'Create Account'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
