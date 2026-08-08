import {
  DEFAULT_CATEGORY,
  PERIOD_IDS,
  STARTER_ACCOUNTS,
  STARTER_CATEGORIES,
  type DriveSchedule,
  type DriveSyncMeta,
  type PeriodId,
  type Settings,
  type Transaction,
} from "../shared/types";

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  /** Shared secret the daily Drive automation presents. Set via `wrangler secret put`. */
  DRIVE_SYNC_TOKEN?: string;
  /** IANA timezone used for the daily 8:00 AM schedule metadata. */
  LEDGERLY_TIMEZONE?: string;
  /** Owner passphrase for the deployed app. Set via `wrangler secret put`. */
  LEDGERLY_PASSWORD?: string;
  /** Optional separate HMAC key for session cookies. */
  SESSION_SECRET?: string;
  /** Set only in `.dev.vars`, which is never deployed. Relaxes auth locally. */
  LEDGERLY_DEV?: string;
}

/* ------------------------------------------------------------------ schema */

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS transactions (
     id TEXT PRIMARY KEY,
     date TEXT NOT NULL,
     merchant TEXT NOT NULL,
     category TEXT NOT NULL DEFAULT 'Needs review',
     amount REAL NOT NULL,
     type TEXT NOT NULL CHECK (type IN ('expense','income')),
     account TEXT NOT NULL DEFAULT 'Imported account',
     tags TEXT NOT NULL DEFAULT '[]',
     receipt INTEGER NOT NULL DEFAULT 0,
     source TEXT NOT NULL,
     fingerprint TEXT NOT NULL UNIQUE,
     createdAt TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category)`,
  `CREATE TABLE IF NOT EXISTS tags (
     name TEXT PRIMARY KEY,
     createdAt TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS rules (
     id TEXT PRIMARY KEY,
     whenText TEXT NOT NULL,
     thenText TEXT NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 1,
     createdAt TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updatedAt TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS documents (
     id TEXT PRIMARY KEY,
     filename TEXT NOT NULL,
     mimeType TEXT NOT NULL,
     size INTEGER NOT NULL,
     objectKey TEXT NOT NULL UNIQUE,
     status TEXT NOT NULL,
     source TEXT NOT NULL,
     createdAt TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_created ON documents (createdAt DESC)`,
];

/**
 * Creates tables and structural settings. Safe to call on every request: all
 * statements are `IF NOT EXISTS` / `INSERT OR IGNORE`, so nothing is destroyed
 * and existing values are never overwritten.
 */
export async function ensureSchema(env: Env): Promise<void> {
  await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
  await ensureStructuralSettings(env);
}

/**
 * Structural (non-financial) defaults. These are lookup configuration only —
 * category and account *names*, never balances or transactions.
 */
export async function ensureStructuralSettings(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const defaults: Array<[string, unknown]> = [
    ["categories", STARTER_CATEGORIES],
    ["accounts", STARTER_ACCOUNTS],
    ["goals", []],
    ["budgets", []],
    ["subscriptions", []],
    ["recurring", []],
    ["dismissedPatterns", []],
    ["assets", 0],
    ["liabilities", 0],
    ["netWorthConfigured", false],
    ["selectedPeriod", "all-time"],
    ["driveFolder", null],
    ["driveSchedule", defaultSchedule(env)],
    ["driveSync", defaultSyncMeta()],
    ["processedFileIds", []],
    ["driveResetAt", null],
    ["freshStart", true],
  ];

  await env.DB.batch(
    defaults.map(([key, value]) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO settings (key, value, updatedAt) VALUES (?, ?, ?)`,
      ).bind(key, JSON.stringify(value), now),
    ),
  );
}

export function defaultSchedule(env: Env): DriveSchedule {
  return {
    time: "08:00",
    timezone: env.LEDGERLY_TIMEZONE || "UTC",
    cadence: "daily",
  };
}

export function defaultSyncMeta(): DriveSyncMeta {
  return {
    lastSyncedAt: null,
    status: "never",
    imported: 0,
    duplicates: 0,
    filesStored: 0,
    review: 0,
    errors: [],
  };
}

/* ---------------------------------------------------------------- settings */

export async function readSettings(
  env: Env,
): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings`,
  ).all<{ key: string; value: string }>();

  const out: Record<string, unknown> = {};
  for (const row of results ?? []) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

export async function writeSetting(
  env: Env,
  key: string,
  value: unknown,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
  )
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run();
}

/** Writes several settings without touching any unrelated key. */
export async function writeSettings(
  env: Env,
  entries: Array<[string, unknown]>,
): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  await env.DB.batch(
    entries.map(([key, value]) =>
      env.DB.prepare(
        `INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      ).bind(key, JSON.stringify(value), now),
    ),
  );
}

/* -------------------------------------------------------------- normalizing */

function asArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function asPeriod(value: unknown): PeriodId {
  return PERIOD_IDS.includes(value as PeriodId)
    ? (value as PeriodId)
    : "all-time";
}

/** Shapes the raw settings rows into the typed object the client expects. */
export function decodeSettings(raw: Record<string, unknown>, env: Env): Settings {
  const schedule = (raw.driveSchedule as DriveSchedule) ?? defaultSchedule(env);
  const sync = (raw.driveSync as DriveSyncMeta) ?? defaultSyncMeta();

  return {
    categories: asArray<string>(raw.categories, STARTER_CATEGORIES),
    accounts: asArray<string>(raw.accounts, STARTER_ACCOUNTS),
    goals: asArray(raw.goals, []),
    budgets: asArray(raw.budgets, []),
    subscriptions: asArray(raw.subscriptions, []),
    recurring: asArray(raw.recurring, []),
    dismissedPatterns: asArray<string>(raw.dismissedPatterns, []),
    assets: asNumber(raw.assets, 0),
    liabilities: asNumber(raw.liabilities, 0),
    netWorthConfigured: raw.netWorthConfigured === true,
    selectedPeriod: asPeriod(raw.selectedPeriod),
    driveFolder: (raw.driveFolder as Settings["driveFolder"]) ?? null,
    driveSchedule: {
      time: schedule.time ?? "08:00",
      timezone: schedule.timezone ?? env.LEDGERLY_TIMEZONE ?? "UTC",
      cadence: "daily",
    },
    driveSync: {
      lastSyncedAt: sync.lastSyncedAt ?? null,
      status: sync.status ?? "never",
      imported: asNumber(sync.imported, 0),
      duplicates: asNumber(sync.duplicates, 0),
      filesStored: asNumber(sync.filesStored, 0),
      review: asNumber(sync.review, 0),
      errors: asArray<string>(sync.errors, []),
    },
    driveResetAt: (raw.driveResetAt as string | null) ?? null,
    freshStart: raw.freshStart === true,
  };
}

/* ------------------------------------------------------------ transactions */

interface TransactionRow {
  id: string;
  date: string;
  merchant: string;
  category: string;
  amount: number;
  type: string;
  account: string;
  tags: string;
  receipt: number;
  source: string;
  fingerprint: string;
  createdAt: string;
}

export function rowToTransaction(row: TransactionRow): Transaction {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === "string");
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    date: row.date,
    merchant: row.merchant,
    category: row.category || DEFAULT_CATEGORY,
    amount: row.amount,
    type: row.type === "income" ? "income" : "expense",
    account: row.account,
    tags,
    receipt: row.receipt === 1,
    source: row.source as Transaction["source"],
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
  };
}

export async function listTransactions(
  env: Env,
  limit = 5000,
): Promise<Transaction[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM transactions ORDER BY date DESC, createdAt DESC LIMIT ?`,
  )
    .bind(limit)
    .all<TransactionRow>();
  return (results ?? []).map(rowToTransaction);
}
