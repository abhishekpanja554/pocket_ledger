/**
 * Types shared by the Worker (server) and the React client.
 * Keep this file free of runtime-environment specific imports.
 */

export type TxType = "expense" | "income";

export type TxSource = "manual" | "csv" | "document" | "google-drive";

export interface Transaction {
  id: string;
  /** ISO YYYY-MM-DD */
  date: string;
  merchant: string;
  category: string;
  /** Always a positive magnitude. `type` carries the direction. */
  amount: number;
  type: TxType;
  account: string;
  tags: string[];
  receipt: boolean;
  source: TxSource;
  fingerprint: string;
  createdAt: string;
}

export interface Tag {
  name: string;
  createdAt: string;
}

export interface Rule {
  id: string;
  whenText: string;
  thenText: string;
  enabled: boolean;
  createdAt: string;
}

export type DocumentStatus = "queued" | "stored" | "review";

export interface DocumentRow {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: DocumentStatus;
  source: "upload" | "google-drive";
  createdAt: string;
  /** objectKey is deliberately NOT sent to the browser. */
}

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

export interface RecurringEntry {
  id: string;
  name: string;
  category: string;
  amount: number;
  cadence: Cadence;
  nextDate: string;
  account?: string;
  active: boolean;
  createdAt: string;
}

export interface SubscriptionEntry {
  id: string;
  name: string;
  group: string;
  amount: number;
  cadence: Cadence;
  nextRenewal: string;
  account?: string;
  active: boolean;
  createdAt: string;
}

export interface Budget {
  id: string;
  category: string;
  limit: number;
  active: boolean;
  createdAt: string;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
  dueDate?: string;
  note?: string;
  createdAt: string;
}

export type PeriodId =
  | "all-time"
  | "this-month"
  | "last-month"
  | "last-3-months"
  | "last-6-months"
  | "this-year";

export const PERIOD_IDS: PeriodId[] = [
  "all-time",
  "this-month",
  "last-month",
  "last-3-months",
  "last-6-months",
  "this-year",
];

export interface DriveFolder {
  id: string;
  name: string;
  url: string;
}

export interface DriveSchedule {
  time: string;
  timezone: string;
  cadence: "daily";
}

export interface DriveSyncMeta {
  lastSyncedAt: string | null;
  status: "never" | "complete" | "partial" | "error";
  imported: number;
  duplicates: number;
  filesStored: number;
  review: number;
  errors: string[];
}

export interface Settings {
  categories: string[];
  accounts: string[];
  goals: Goal[];
  budgets: Budget[];
  subscriptions: SubscriptionEntry[];
  recurring: RecurringEntry[];
  dismissedPatterns: string[];
  assets: number;
  liabilities: number;
  netWorthConfigured: boolean;
  selectedPeriod: PeriodId;
  driveFolder: DriveFolder | null;
  driveSchedule: DriveSchedule;
  driveSync: DriveSyncMeta;
  driveResetAt: string | null;
  freshStart: boolean;
}

export interface AppState {
  transactions: Transaction[];
  tags: Tag[];
  rules: Rule[];
  settings: Settings;
  documents: DocumentRow[];
}

/** Payload accepted by POST /api/transactions (single or `{ transactions: [] }`). */
export interface TransactionInput {
  date: string;
  merchant: string;
  amount: number;
  type: TxType;
  category?: string;
  account?: string;
  tags?: string[];
  receipt?: boolean;
  source?: TxSource;
}

export interface TransactionWriteResult {
  inserted: number;
  duplicates: number;
  skipped: number;
  needsReview: number;
  errors: string[];
  rows: Transaction[];
}

export const DEFAULT_CATEGORY = "Needs review";
export const DEFAULT_ACCOUNT = "Imported account";
export const WIPE_CONFIRMATION = "DELETE ALL LEDGERLY DATA";
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const STARTER_CATEGORIES = [
  "Housing",
  "Groceries",
  "Shopping",
  "Dining",
  "Transportation",
  "Utilities",
  "Subscriptions",
  "Insurance",
  "Health",
  "Entertainment",
  "Income",
  "Needs review",
  "Other",
];

export const STARTER_ACCOUNTS = [
  "Main Checking",
  "Everyday Visa",
  "Rewards Card",
  "Cash",
];
