// ── FlowCast Shared Types ─────────────────────────────────────────────────────

export type IncomeType = 'W2' | 'MONTHLY_RECURRING' | 'AD_HOC';
export type BillType = 'EXPENSE' | 'TRANSFER' | 'SAVINGS';

export interface PayPeriod {
  id: string;
  startDate: string;
  endDate: string;
  paydayDate: string;
  openingBalance: number;
  balanceSnapshot?: BalanceSnapshot;
}

export interface BalanceSnapshot {
  plannedBalance: number;
  runningBalance: number;
  totalIncome: number;
  totalExpenses: number;
  isStale: boolean;
  computedAt: string;
}

export interface BillTemplate {
  id: string;
  name: string;
  group: string;
  billType: BillType;
  dueDayOfMonth: number | null;
  defaultAmount: number;
  isActive: boolean;
  isDiscretionary: boolean;
  sortOrder: number;
}

export interface BillInstance {
  id: string;
  payPeriodId: string;
  billTemplateId: string;
  projectedAmount: number;
  actualAmount: number | null;
  isReconciled: boolean;
  isFrozen: boolean;
  reconciledAt: string | null;
  notes: string | null;
  billTemplate: BillTemplate;
}

export interface IncomeSource {
  id: string;
  name: string;
  type: IncomeType;
  defaultAmount: number;
  dayOfMonth: number | null;
  isActive: boolean;
  propagateOnReconcile: boolean;
}

export interface IncomeEntry {
  id: string;
  payPeriodId: string;
  incomeSourceId: string;
  projectedAmount: number;
  actualAmount: number | null;
  isReconciled: boolean;
  reconciledAt: string | null;
  notes: string | null;
  incomeSource: IncomeSource;
}

export interface PeriodProjection {
  payPeriodId: string;
  paydayDate: string;
  startDate: string;
  endDate: string;
  plannedBalance: number;
  runningBalance: number;
  difference: number;
  totalIncome: number;
  totalExpenses: number;
  bills: BillProjectionItem[];
  income: IncomeProjectionItem[];
}

export interface BillProjectionItem {
  billInstanceId: string;
  billTemplateId: string;
  name: string;
  group: string;
  dueDayOfMonth: number | null;
  projectedAmount: number;
  actualAmount: number | null;
  isReconciled: boolean;
  isFrozen: boolean;
}

export interface IncomeProjectionItem {
  incomeEntryId: string;
  incomeSourceId: string;
  name: string;
  type: IncomeType;
  projectedAmount: number;
  actualAmount: number | null;
  isReconciled: boolean;
}

export interface ReconcilePayload {
  actualAmount: number;
  notes?: string;
}
