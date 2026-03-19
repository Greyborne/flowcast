import { useState } from 'react';
import ScheduleTab from '../components/Settings/ScheduleTab';
import BillTemplatesTab from '../components/Settings/BillTemplatesTab';
import IncomeSourcesTab from '../components/Settings/IncomeSourcesTab';

const TABS = [
  { id: 'schedule',  label: 'Schedule & Balance' },
  { id: 'bills',     label: 'Bill Templates' },
  { id: 'income',    label: 'Income Sources' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('schedule');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Settings</h2>
        <p className="text-sm text-gray-500 mt-1">Manage your pay schedule, bill templates, and income sources.</p>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex gap-1 border-b border-gray-800 pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px ${
              activeTab === tab.id
                ? 'bg-gray-900 text-white border border-gray-800 border-b-gray-900'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === 'schedule' && <ScheduleTab />}
      {activeTab === 'bills'    && <BillTemplatesTab />}
      {activeTab === 'income'   && <IncomeSourcesTab />}
    </div>
  );
}
