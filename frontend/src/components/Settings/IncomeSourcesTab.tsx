import { useState } from 'react';
import {
  useIncomeSources,
  useCreateIncomeSource,
  useUpdateIncomeSource,
  useArchiveIncomeSource,
  type IncomeSourceForm,
} from '../../hooks/useTemplates';

const INCOME_TYPES = [
  { value: 'W2',                label: 'W2 (propagates on reconcile)' },
  { value: 'MONTHLY_RECURRING', label: 'Monthly Recurring' },
  { value: 'AD_HOC',            label: 'Ad Hoc (one-time)' },
];

const EMPTY_FORM: IncomeSourceForm = {
  name: '',
  type: 'W2',
  defaultAmount: 0,
  propagateOnReconcile: false,
  isActive: true,
  startDate: new Date().toISOString().slice(0, 10),
};

interface EditFormProps {
  initial: IncomeSourceForm;
  onSave: (form: IncomeSourceForm) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function EditForm({ initial, onSave, onCancel, saving }: EditFormProps) {
  const [form, setForm] = useState<IncomeSourceForm>(initial);
  const set = (patch: Partial<IncomeSourceForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="grid grid-cols-2 gap-3 p-4 bg-gray-800/50 rounded-lg border border-gray-700 mt-2">
      <div className="space-y-1">
        <label className="text-xs text-gray-400">Name</label>
        <input
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Type</label>
        <select
          value={form.type}
          onChange={(e) => set({
            type: e.target.value,
            propagateOnReconcile: e.target.value === 'W2',
          })}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          {INCOME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Default Amount (per period)</label>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={form.defaultAmount}
            onChange={(e) => set({ defaultAmount: parseFloat(e.target.value) || 0 })}
            className="w-full bg-gray-800 border border-gray-700 rounded pl-5 pr-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 pt-3">
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={form.propagateOnReconcile}
            onChange={(e) => set({ propagateOnReconcile: e.target.checked })}
            className="rounded"
          />
          Propagate on reconcile
        </label>
      </div>

      <div className="col-span-2 flex gap-2 pt-1">
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim()}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-gray-400 hover:text-white text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function IncomeSourcesTab() {
  const { data: sources, isLoading } = useIncomeSources();
  const createSource = useCreateIncomeSource();
  const updateSource = useUpdateIncomeSource();
  const archiveSource = useArchiveIncomeSource();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  if (isLoading) {
    return <div className="flex items-center justify-center h-48 text-gray-500">Loading income sources...</div>;
  }

  const active   = sources?.filter((s) => s.isActive) ?? [];
  const archived = sources?.filter((s) => !s.isActive) ?? [];

  const fmt = (n: number) =>
    n === 0 ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  const typeLabel: Record<string, string> = {
    W2: 'W2',
    MONTHLY_RECURRING: 'Monthly',
    AD_HOC: 'Ad Hoc',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{active.length} active income sources</p>
        <button
          onClick={() => { setShowAdd(true); setEditingId(null); }}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          + Add Source
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <EditForm
          initial={EMPTY_FORM}
          onSave={async (form) => {
            await createSource.mutateAsync(form);
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
          saving={createSource.isPending}
        />
      )}

      {/* Active sources */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-2 bg-gray-800/60 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Income Sources</span>
        </div>
        <div className="divide-y divide-gray-800/50">
          {active.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-600 text-center">No income sources. Add one above.</p>
          )}
          {active.map((s) => (
            <div key={s.id}>
              <div className="flex items-center px-4 py-2.5 hover:bg-gray-800/30 group">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-white">{s.name}</span>
                  <span className="ml-2 text-xs text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">
                    {typeLabel[s.type] ?? s.type}
                  </span>
                  {s.propagateOnReconcile && (
                    <span className="ml-1 text-xs text-green-400 bg-green-900/30 px-1.5 py-0.5 rounded">propagates</span>
                  )}
                </div>
                <div className="flex items-center gap-6 text-sm text-gray-400 shrink-0">
                  <span className="w-24 text-right font-mono">{fmt(s.defaultAmount)}</span>
                  <button
                    onClick={() => setEditingId(editingId === s.id ? null : s.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-blue-400 hover:text-blue-300 transition-all"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => archiveSource.mutate({ id: s.id })}
                    className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-300 transition-all"
                  >
                    Archive
                  </button>
                </div>
              </div>

              {editingId === s.id && (
                <div className="px-4 pb-3">
                  <EditForm
                    initial={s}
                    onSave={async (form) => {
                      await updateSource.mutateAsync({ id: s.id, form });
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                    saving={updateSource.isPending}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Archived */}
      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showArchived ? '▼' : '▶'} {archived.length} archived source{archived.length !== 1 ? 's' : ''}
          </button>
          {showArchived && (
            <div className="mt-2 bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800/50">
              {archived.map((s) => (
                <div key={s.id} className="flex items-center px-4 py-2.5 opacity-50 hover:opacity-80 group">
                  <span className="flex-1 text-sm text-gray-400 line-through">{s.name}</span>
                  <button
                    onClick={() => archiveSource.mutate({ id: s.id, restore: true })}
                    className="opacity-0 group-hover:opacity-100 text-xs text-green-400 hover:text-green-300 transition-all"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
