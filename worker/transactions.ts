import type { Rule, Transaction, TransactionWriteResult } from "../shared/types";
import { DEFAULT_CATEGORY } from "../shared/types";
import { rowToTransaction, type Env } from "./db";
import {
  applyRules,
  fingerprintOf,
  uuid,
  validateTransaction,
  type ValidTransaction,
} from "./util";

export async function loadEnabledRules(env: Env): Promise<Rule[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM rules WHERE enabled = 1 ORDER BY createdAt ASC`,
  ).all<{
    id: string;
    whenText: string;
    thenText: string;
    enabled: number;
    createdAt: string;
  }>();
  return (results ?? []).map((r) => ({ ...r, enabled: r.enabled === 1 }));
}

/**
 * The one insertion path for every source. Duplicate detection happens first
 * (in-batch, then against D1, then via the UNIQUE fingerprint constraint), and
 * categorization rules run afterwards on survivors only.
 */
export async function insertTransactions(
  env: Env,
  rawInputs: unknown[],
  options: { applyRules?: boolean } = {},
): Promise<TransactionWriteResult> {
  const result: TransactionWriteResult = {
    inserted: 0,
    duplicates: 0,
    skipped: 0,
    needsReview: 0,
    errors: [],
    rows: [],
  };

  if (rawInputs.length === 0) return result;

  const candidates: Array<{ value: ValidTransaction; fingerprint: string }> = [];
  const seenInBatch = new Set<string>();

  for (const raw of rawInputs) {
    const validated = validateTransaction(raw);
    if (!validated.ok) {
      result.skipped += 1;
      if (result.errors.length < 20) result.errors.push(validated.error);
      continue;
    }
    const fingerprint = fingerprintOf(validated.value);
    if (seenInBatch.has(fingerprint)) {
      result.duplicates += 1;
      continue;
    }
    seenInBatch.add(fingerprint);
    candidates.push({ value: validated.value, fingerprint });
  }

  if (candidates.length === 0) return result;

  // Pre-check against what is already stored so the reported duplicate count is
  // accurate; the UNIQUE constraint below is what actually guarantees it.
  const existing = await findExistingFingerprints(
    env,
    candidates.map((c) => c.fingerprint),
  );

  const rules = options.applyRules ? await loadEnabledRules(env) : [];
  const now = new Date().toISOString();
  const toInsert: Transaction[] = [];

  for (const candidate of candidates) {
    if (existing.has(candidate.fingerprint)) {
      result.duplicates += 1;
      continue;
    }
    const finalValue = rules.length
      ? applyRules(candidate.value, rules)
      : candidate.value;

    toInsert.push({
      id: uuid(),
      ...finalValue,
      fingerprint: candidate.fingerprint,
      createdAt: now,
    });
  }

  if (toInsert.length === 0) return result;

  const statements = toInsert.map((tx) =>
    env.DB.prepare(
      `INSERT INTO transactions
         (id, date, merchant, category, amount, type, account, tags, receipt, source, fingerprint, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fingerprint) DO NOTHING`,
    ).bind(
      tx.id,
      tx.date,
      tx.merchant,
      tx.category,
      tx.amount,
      tx.type,
      tx.account,
      JSON.stringify(tx.tags),
      tx.receipt ? 1 : 0,
      tx.source,
      tx.fingerprint,
      tx.createdAt,
    ),
  );

  const batchResults = await env.DB.batch(statements);

  batchResults.forEach((res, index) => {
    const changed = (res.meta?.changes ?? 0) > 0;
    const tx = toInsert[index];
    if (changed) {
      result.inserted += 1;
      result.rows.push(tx);
      if (tx.category === DEFAULT_CATEGORY) result.needsReview += 1;
    } else {
      // Lost a race against a concurrent import with the same fingerprint.
      result.duplicates += 1;
    }
  });

  await registerTags(
    env,
    result.rows.flatMap((tx) => tx.tags),
  );

  return result;
}

async function findExistingFingerprints(
  env: Env,
  fingerprints: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const CHUNK = 100;
  for (let i = 0; i < fingerprints.length; i += CHUNK) {
    const chunk = fingerprints.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT fingerprint FROM transactions WHERE fingerprint IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<{ fingerprint: string }>();
    for (const row of results ?? []) found.add(row.fingerprint);
  }
  return found;
}

/** Makes sure any tag used on a transaction also exists as a global definition. */
export async function registerTags(env: Env, names: string[]): Promise<void> {
  const unique = new Map<string, string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed) unique.set(trimmed.toLowerCase(), trimmed);
  }
  if (unique.size === 0) return;

  const now = new Date().toISOString();
  await env.DB.batch(
    [...unique.values()].map((name) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO tags (name, createdAt) VALUES (?, ?)`,
      ).bind(name, now),
    ),
  );
}

export async function getTransaction(
  env: Env,
  id: string,
): Promise<Transaction | null> {
  const row = await env.DB.prepare(`SELECT * FROM transactions WHERE id = ?`)
    .bind(id)
    .first();
  return row ? rowToTransaction(row as never) : null;
}
