// ── FlowCast Shared Types ─────────────────────────────────────────────────────

export type IncomeType = 'W2' | 'MONTHLY_RECURRING' | 'AD_HOC';
export type BillType = 'EXPENSE' | 'TRANSFER' | 'SAVINGS';

export interface PayPeriod {
  id: string;
  startDate: string;
  endDate: string;
  paydayDate: string;
  openingBalance: number;
  isClosed: boolean;
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

export interface IncomeGridEntry {
  id: string;
  projectedAmount: number;
  actualAmount: number | null;
  isReconciled: boolean;
  notes: string | null;
}

export interface IncomeGridData {
  sources: IncomeSource[];
  entryMap: Record<string, Record<string, IncomeGridEntry>>;
}

export interface BillGridInstance {
  id: string;
  projectedAmount: number;
  actualAmount: number | null;
  isReconciled: boolean;
  isFrozen: boolean;
  notes: string | null;
}

export interface BillGridData {
  templates: BillTemplate[];
  instanceMap: Record<string, Record<string, BillGridInstance>>;
  groups: string[];
}

// ── Transactions ──────────────────────────────────────────────────────────────

export type TransactionStatus = 'UNMATCHED' | 'MATCHED' | 'IGNORED';
export type TransactionSource = 'OFX' | 'CSV' | 'MANUAL';

export interface Transaction {
  id: string;
  importBatchId: string | null;
  dedupeKey: string | null;
  date: string;
  amount: number;
  description: string;
  memo: string | null;
  transactionType: string | null;
  source: TransactionSource;
  status: TransactionStatus;
  billInstanceId: string | null;
  incomeEntryId: string | null;
  notes: string | null;
  createdAt: string;
  billInstance?: {
    id: string;
    projectedAmount: number;
    actualAmount: number | null;
    billTemplate: { name: string; group: string };
  } | null;
  incomeEntry?: {
    id: string;
    projectedAmount: number;
    actualAmount: number | null;
    incomeSource: { name: string };
  } | null;
  importBatch?: { filename: string; format: string } | null;
}

export interface ImportBatch {
  id: string;
  filename: string;
  format: string;
  importedAt: string;
  totalCount: number;
  importedCount: number;
  skippedCount: number;
  matchedCount: number;
  status: string;
  _count?: { transactions: number };
}

export interface AutoMatchRule {
  id: string;
  pattern: string;
  matchType: 'CONTAINS' | 'STARTS_WITH' | 'REGEX';
  targetType: 'BILL' | 'INCOME';
  targetId: string;
  priority: number;
  isActive: boolean;
}

export interface ImportResult {
  batchId: string;
  totalCount: number;
  importedCount: number;
  skippedCount: number;
  matchedCount: number;
  format: string;
}

export interface MatchCandidate {
  kind: 'INSTANCE' | 'TEMPLATE';
  id: string;
  templateId: string;
  payPeriodId: string | null;
  name: string;
  projectedAmount: number;
  paydayDate: string | null;
  type: 'BILL' | 'INCOME';
}
