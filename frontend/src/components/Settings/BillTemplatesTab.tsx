import { useState } from 'react';
import {
  useBillTemplates,
  useCreateBillTemplate,
  useUpdateBillTemplate,
  useArchiveBillTemplate,
  type BillTemplateForm,
} from '../../hooks/useTemplates';

const BILL_GROUPS = [
  '1. Long-Term Credit',
  '2. Bills',
  '3. Vehicle Loan',
  '4. Credit Card Payments',
  '5. Savings',
  '6. Discretionary',
];

const EMPTY_FORM: BillTemplateForm = {
  name: '',
  group: '2. Bills',
  dueDayOfMonth: null,
  defaultAmount: 0,
  isDiscretionary: false,
  sortOrder: 0,
  isActive: true,
};

interface EditFormProps {
  initial: BillTemplateForm;
  onSave: (form: BillTemplateForm) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function EditForm({ initial, onSave, onCancel, saving }: EditFormProps) {
  const [form, setForm] = useState<BillTemplateForm>(initial);

  const set = (patch: Partial<BillTemplateForm>) => setForm((f) => ({ ...f, ...patch }));

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
        <label className="text-xs text-gray-400">Group</label>
        <select
          value={form.group}
          onChange={(e) => set({ group: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          {BILL_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Due Day of Month</label>
        <input
          type="number"
          min={1} max={31}
          value={form.dueDayOfMonth ?? ''}
          onChange={(e) => set({ dueDayOfMonth: e.target.value ? parseInt(e.target.value) : null })}
          placeholder="—"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Default Amount</label>
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

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Sort Order</label>
        <input
          type="number"
          value={form.sortOrder}
          onChange={(e) => set({ sortOrder: parseInt(e.target.value) || 0 })}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="flex items-center gap-4 pt-3">
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isDiscretionary}
            onChange={(e) => set({ isDiscretionary: e.target.checked })}
            className="rounded"
          />
          Discretionary
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

export default function BillTemplatesTab() {
  const { data: templates, isLoading } = useBillTemplates();
  const createTemplate = useCreateBillTemplate();
  const updateTemplate = useUpdateBillTemplate();
  const archiveTemplate = useArchiveBillTemplate();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  if (isLoading) {
    return <div className="flex items-center justify-center h-48 text-gray-500">Loading templates...</div>;
  }

  const active   = templates?.filter((t) => t.isActive) ?? [];
  const archived = templates?.filter((t) => !t.isActive) ?? [];

  // Group active templates
  const groups = BILL_GROUPS.reduce<Record<string, typeof active>>((acc, g) => {
    acc[g] = active.filter((t) => t.group === g);
    return acc;
  }, {});
  // Any templates with groups not in the list
  const otherGroup = active.filter((t) => !BILL_GROUPS.includes(t.group));
  if (otherGroup.length > 0) groups['Other'] = otherGroup;

  const fmt = (n: number) =>
    n === 0 ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{active.length} active templates</p>
        <button
          onClick={() => { setShowAdd(true); setEditingId(null); }}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          + Add Template
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <EditForm
          initial={EMPTY_FORM}
          onSave={async (form) => {
            await createTemplate.mutateAsync(form);
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
          saving={createTemplate.isPending}
        />
      )}

      {/* Grouped templates */}
      {Object.entries(groups).map(([group, items]) => (
        items.length === 0 ? null : (
          <section key={group} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-4 py-2 bg-gray-800/60 border-b border-gray-800">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{group}</span>
            </div>
            <div className="divide-y divide-gray-800/50">
              {items.map((t) => (
                <div key={t.id}>
                  <div className="flex items-center px-4 py-2.5 hover:bg-gray-800/30 group">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-white">{t.name}</span>
                      {t.isDiscretionary && (
                        <span className="ml-2 text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">discretionary</span>
                      )}
                    </div>
                    <div className="flex items-center gap-6 text-sm text-gray-400 shrink-0">
                      <span className="w-16 text-right">
                        {t.dueDayOfMonth ? `Day ${t.dueDayOfMonth}` : '—'}
                      </span>
                      <span className="w-24 text-right font-mono">{fmt(t.defaultAmount)}</span>
                      <button
                        onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-blue-400 hover:text-blue-300 transition-all"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => archiveTemplate.mutate({ id: t.id })}
                        className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-300 transition-all"
                      >
                        Archive
                      </button>
                    </div>
                  </div>

                  {editingId === t.id && (
                    <div className="px-4 pb-3">
                      <EditForm
                        initial={t}
                        onSave={async (form) => {
                          await updateTemplate.mutateAsync({ id: t.id, form });
                          setEditingId(null);
                        }}
                        onCancel={() => setEditingId(null)}
                        saving={updateTemplate.isPending}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )
      ))}

      {/* Archived */}
      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showArchived ? '▼' : '▶'} {archived.length} archived template{archived.length !== 1 ? 's' : ''}
          </button>
          {showArchived && (
            <div className="mt-2 bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800/50">
              {archived.map((t) => (
                <div key={t.id} className="flex items-center px-4 py-2.5 opacity-50 hover:opacity-80 group">
                  <span className="flex-1 text-sm text-gray-400 line-through">{t.name}</span>
                  <button
                    onClick={() => archiveTemplate.mutate({ id: t.id, restore: true })}
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
