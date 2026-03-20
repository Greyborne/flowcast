import { useState } from 'react';
import {
  useBillTemplates,
  useCreateBillTemplate,
  useUpdateBillTemplate,
  useArchiveBillTemplate,
  useBillGroups,
  useCreateBillGroup,
  useRenameBillGroup,
  useDeleteBillGroup,
  useSetMonthlyAmount,
  useDeleteMonthlyAmount,
  type BillTemplateForm,
  type MonthlyAmountOverride,
} from '../../hooks/useTemplates';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const THIS_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [THIS_YEAR, THIS_YEAR + 1, THIS_YEAR + 2];

const EMPTY_FORM: BillTemplateForm = {
  name: '',
  group: '',
  dueDayOfMonth: null,
  defaultAmount: 0,
  isDiscretionary: false,
  sortOrder: 0,
  isActive: true,
};

// ── Group edit form ───────────────────────────────────────────────────────────

interface GroupFormProps {
  initial: string;                    // current name (empty string = new group)
  allGroups: string[];                // all groups except the one being edited
  currentPosition?: string | null;    // predecessor group name (null=first, undefined=use default)
  onSave: (name: string, positionAfterId: string | null) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function GroupForm({ initial, allGroups, currentPosition, onSave, onCancel, saving }: GroupFormProps) {
  const [name, setName] = useState(initial);
  // If editing: start at current position. If new: default to last.
  const defaultPos = currentPosition !== undefined
    ? currentPosition
    : (allGroups.length > 0 ? allGroups[allGroups.length - 1] : null);
  const [positionAfterId, setPositionAfterId] = useState<string | null>(defaultPos);

  return (
    <div className="flex items-end gap-3 px-4 py-3 bg-gray-800/60 border border-gray-700 rounded-lg">
      <div className="space-y-1 flex-1">
        <label className="text-xs text-gray-400">Group Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          placeholder="e.g. 7. Utilities"
          autoFocus
        />
      </div>
      <div className="space-y-1 flex-1">
        <label className="text-xs text-gray-400">Position</label>
        <select
          value={positionAfterId === null ? '__first__' : positionAfterId}
          onChange={(e) => setPositionAfterId(e.target.value === '__first__' ? null : e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="__first__">First</option>
          {allGroups.map((g) => (
            <option key={g} value={g}>After {g}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 pb-0.5">
        <button
          onClick={() => onSave(name.trim(), positionAfterId)}
          disabled={saving || !name.trim()}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-gray-400 hover:text-white text-sm transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Bill template edit form ───────────────────────────────────────────────────

interface GroupBill { id: string; name: string; }

interface EditFormProps {
  initial: BillTemplateForm & { id?: string; monthlyAmounts?: MonthlyAmountOverride[] };
  allGroups: string[];
  groupBills: GroupBill[];
  currentPosition?: string | null;
  onGroupChange: (group: string) => void;
  onSave: (form: BillTemplateForm, positionAfterId: string | null) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function EditForm({ initial, allGroups, groupBills, currentPosition, onGroupChange, onSave, onCancel, saving }: EditFormProps) {
  const [form, setForm] = useState<BillTemplateForm>(initial);
  const defaultPosition = currentPosition !== undefined
    ? currentPosition
    : (groupBills.length > 0 ? groupBills[groupBills.length - 1].id : null);
  const [positionAfterId, setPositionAfterId] = useState<string | null>(defaultPosition);
  const [showOverrides, setShowOverrides] = useState(false);
  const [newOverride, setNewOverride] = useState({ year: THIS_YEAR, month: 1, amount: '' });
  const setMonthly = useSetMonthlyAmount();
  const deleteMonthly = useDeleteMonthlyAmount();
  const set = (patch: Partial<BillTemplateForm>) => setForm((f) => ({ ...f, ...patch }));

  const handleGroupChange = (group: string) => {
    set({ group });
    onGroupChange(group);
    setPositionAfterId('__last__');
  };

  const resolvedPosition = positionAfterId === '__last__'
    ? (groupBills.length > 0 ? groupBills[groupBills.length - 1].id : null)
    : positionAfterId;

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
          onChange={(e) => handleGroupChange(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          {allGroups.map((g) => <option key={g} value={g}>{g}</option>)}
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
        <label className="text-xs text-gray-400">Position in Group</label>
        <select
          value={positionAfterId === null ? '__first__' : (positionAfterId === '__last__' ? '__last__' : positionAfterId)}
          onChange={(e) => setPositionAfterId(e.target.value === '__first__' ? null : e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="__first__">First in group</option>
          {groupBills.map((b) => (
            <option key={b.id} value={b.id}>After {b.name}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-4 pt-4">
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

      {/* Monthly amount overrides — only shown when editing an existing template */}
      {initial.id && (
        <div className="col-span-2 border-t border-gray-700/60 pt-3">
          <button
            onClick={() => setShowOverrides((v) => !v)}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span>{showOverrides ? '▼' : '▶'}</span>
            <span>Monthly Amount Overrides</span>
            {(initial.monthlyAmounts?.length ?? 0) > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-blue-900/40 text-blue-400 rounded text-[10px]">
                {initial.monthlyAmounts!.length}
              </span>
            )}
          </button>

          {showOverrides && (
            <div className="mt-2 space-y-2">
              {/* Existing overrides */}
              {(initial.monthlyAmounts ?? []).length === 0 && (
                <p className="text-xs text-gray-600 italic">No overrides set. The default amount applies to all months.</p>
              )}
              {(initial.monthlyAmounts ?? []).map((o) => (
                <div key={o.id} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-24">{MONTH_NAMES[o.month - 1]} {o.year}</span>
                  <span className="text-white font-mono">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(o.amount)}
                  </span>
                  <button
                    onClick={() => deleteMonthly.mutate({ templateId: initial.id!, year: o.year, month: o.month })}
                    disabled={deleteMonthly.isPending}
                    className="text-red-500 hover:text-red-400 ml-auto disabled:opacity-50"
                    title="Remove override"
                  >
                    ×
                  </button>
                </div>
              ))}

              {/* Add new override */}
              <div className="flex items-end gap-2 pt-1 border-t border-gray-700/40">
                <div className="space-y-0.5">
                  <label className="text-[10px] text-gray-500">Year</label>
                  <select
                    value={newOverride.year}
                    onChange={(e) => setNewOverride((o) => ({ ...o, year: Number(e.target.value) }))}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none"
                  >
                    {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-gray-500">Month</label>
                  <select
                    value={newOverride.month}
                    onChange={(e) => setNewOverride((o) => ({ ...o, month: Number(e.target.value) }))}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none"
                  >
                    {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-gray-500">Amount</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-[10px]">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={newOverride.amount}
                      onChange={(e) => setNewOverride((o) => ({ ...o, amount: e.target.value }))}
                      className="bg-gray-800 border border-gray-700 rounded pl-4 pr-2 py-1 text-xs text-white w-24 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const amount = parseFloat(newOverride.amount);
                    if (isNaN(amount) || !initial.id) return;
                    await setMonthly.mutateAsync({ templateId: initial.id, year: newOverride.year, month: newOverride.month, amount });
                    setNewOverride((o) => ({ ...o, amount: '' }));
                  }}
                  disabled={setMonthly.isPending || !newOverride.amount}
                  className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-xs rounded transition-colors"
                >
                  {setMonthly.isPending ? '…' : 'Add'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="col-span-2 flex gap-2 pt-1">
        <button
          onClick={() => onSave(form, resolvedPosition)}
          disabled={saving || !form.name.trim()}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-4 py-1.5 text-gray-400 hover:text-white text-sm transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────────

export default function BillTemplatesTab() {
  const { data: groups = [], isLoading: groupsLoading } = useBillGroups();
  const { data: templates, isLoading: templatesLoading } = useBillTemplates();
  const createTemplate  = useCreateBillTemplate();
  const updateTemplate  = useUpdateBillTemplate();
  const archiveTemplate = useArchiveBillTemplate();
  const createGroup     = useCreateBillGroup();
  const renameGroup     = useRenameBillGroup();
  const deleteGroup     = useDeleteBillGroup();

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName]   = useState<string | null>(null); // null=none, ''=new
  const [showAdd, setShowAdd]         = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [formGroup, setFormGroup]     = useState<string>('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (groupsLoading || templatesLoading) {
    return <div className="flex items-center justify-center h-48 text-gray-500">Loading...</div>;
  }

  const active   = templates?.filter((t) => t.isActive) ?? [];
  const archived = templates?.filter((t) => !t.isActive) ?? [];

  // Build template map per group, in group order
  const templatesByGroup = groups.reduce<Record<string, typeof active>>((acc, g) => {
    acc[g] = active.filter((t) => t.group === g);
    return acc;
  }, {});
  const ungrouped = active.filter((t) => !groups.includes(t.group));

  const fmt = (n: number) =>
    n === 0 ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  const getSiblings = (group: string, excludeId?: string): GroupBill[] =>
    (templatesByGroup[group] ?? [])
      .filter((t) => t.id !== excludeId)
      .map((t) => ({ id: t.id, name: t.name }));

  const handleDeleteGroup = async (name: string) => {
    setDeleteError(null);
    try {
      await deleteGroup.mutateAsync(name);
    } catch (err: any) {
      setDeleteError(err.response?.data?.error ?? 'Failed to delete group');
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{active.length} active templates · {groups.length} groups</p>
        <div className="flex gap-2">
          <button
            onClick={() => { setEditingGroupName(''); setEditingTemplateId(null); setShowAdd(false); }}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
          >
            + Add Group
          </button>
          <button
            onClick={() => {
              setShowAdd(true);
              setEditingGroupName(null);
              setEditingTemplateId(null);
              setFormGroup(groups[0] ?? '');
            }}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            + Add Template
          </button>
        </div>
      </div>

      {deleteError && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-4 py-2">
          {deleteError}
        </p>
      )}

      {/* New group form */}
      {editingGroupName === '' && (
        <GroupForm
          initial=""
          allGroups={groups}
          onSave={async (name, positionAfterId) => {
            await createGroup.mutateAsync({ name, positionAfterId });
            setEditingGroupName(null);
          }}
          onCancel={() => setEditingGroupName(null)}
          saving={createGroup.isPending}
        />
      )}

      {/* Add template form */}
      {showAdd && (
        <EditForm
          initial={{ ...EMPTY_FORM, group: formGroup || groups[0] || '' }}
          allGroups={groups}
          groupBills={getSiblings(formGroup)}
          onGroupChange={setFormGroup}
          onSave={async (form, positionAfterId) => {
            await createTemplate.mutateAsync({ ...form, positionAfterId } as any);
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
          saving={createTemplate.isPending}
        />
      )}

      {/* Groups + templates */}
      {groups.map((group) => (
        <section key={group} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          {/* Group header */}
          {editingGroupName === group ? (
            <div className="px-4 py-2 bg-gray-800/60 border-b border-gray-800">
              <GroupForm
                initial={group}
                allGroups={groups.filter((g) => g !== group)}
                currentPosition={(() => {
                  const idx = groups.indexOf(group);
                  return idx === 0 ? null : groups[idx - 1];
                })()}
                onSave={async (newName, positionAfterId) => {
                  await renameGroup.mutateAsync({ oldName: group, newName, positionAfterId });
                  setEditingGroupName(null);
                }}
                onCancel={() => setEditingGroupName(null)}
                saving={renameGroup.isPending}
              />
            </div>
          ) : (
            <div className="px-4 py-2 bg-gray-800/60 border-b border-gray-800 flex items-center justify-between group/header">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{group}</span>
              <div className="flex gap-3 opacity-0 group-hover/header:opacity-100 transition-opacity">
                <button
                  onClick={() => { setEditingGroupName(group); setDeleteError(null); }}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteGroup(group)}
                  className="text-xs text-red-400 hover:text-red-300"
                  title={templatesByGroup[group]?.length > 0 ? 'Remove all templates first' : 'Delete group'}
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          {/* Templates in this group */}
          <div className="divide-y divide-gray-800/50">
            {(templatesByGroup[group] ?? []).length === 0 && (
              <p className="px-4 py-3 text-xs text-gray-600 italic">No templates in this group.</p>
            )}
            {(templatesByGroup[group] ?? []).map((t) => (
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
                      onClick={() => { setEditingTemplateId(editingTemplateId === t.id ? null : t.id); setFormGroup(t.group); }}
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

                {editingTemplateId === t.id && (
                  <div className="px-4 pb-3">
                    <EditForm
                      initial={t}
                      allGroups={groups}
                      groupBills={getSiblings(formGroup, t.id)}
                      currentPosition={(() => {
                        const siblings = templatesByGroup[t.group] ?? [];
                        const idx = siblings.findIndex((s) => s.id === t.id);
                        return idx === 0 ? null : siblings[idx - 1].id;
                      })()}
                      onGroupChange={setFormGroup}
                      onSave={async (form, positionAfterId) => {
                        await updateTemplate.mutateAsync({ id: t.id, form: { ...form, positionAfterId } as any });
                        setEditingTemplateId(null);
                      }}
                      onCancel={() => setEditingTemplateId(null)}
                      saving={updateTemplate.isPending}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Ungrouped templates (safety net) */}
      {ungrouped.length > 0 && (
        <section className="bg-gray-900 rounded-xl border border-amber-800/30 overflow-hidden">
          <div className="px-4 py-2 bg-gray-800/60 border-b border-gray-800">
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Ungrouped</span>
          </div>
          <div className="divide-y divide-gray-800/50">
            {ungrouped.map((t) => (
              <div key={t.id} className="flex items-center px-4 py-2.5 text-sm">
                <span className="flex-1 text-white">{t.name}</span>
                <span className="text-gray-500 text-xs">{t.group}</span>
              </div>
            ))}
          </div>
        </section>
      )}

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
                  <span className="text-xs text-gray-600 mr-4">{t.group}</span>
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
