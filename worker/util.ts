import {
  DEFAULT_ACCOUNT,
  DEFAULT_CATEGORY,
  type Rule,
  type TransactionInput,
  type TxSource,
  type TxType,
} from "../shared/types";

export function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Length-checked, constant-loop string comparison. Both operands here are
 * random secrets or HMACs, so leaking length is not meaningful.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The single duplicate fingerprint used by every import path — manual, CSV,
 * document extraction and Google Drive. Backed by a UNIQUE constraint in D1 so
 * two simultaneous imports cannot both win.
 */
export function fingerprintOf(input: {
  date: string;
  merchant: string;
  amount: number;
  account: string;
}): string {
  return [
    input.date,
    input.merchant.trim().toLowerCase(),
    input.amount.toFixed(2),
    input.account.trim().toLowerCase(),
  ].join("|");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts YYYY-MM-DD, DD/MM/YYYY, ISO timestamps and textual dates.
 * Ambiguous numeric dates are read day-first, matching Indian statements.
 */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  if (ISO_DATE.test(raw)) return isRealDate(raw) ? raw : null;

  const isoTimestamp = raw.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  if (isoTimestamp) return isRealDate(isoTimestamp[1]) ? isoTimestamp[1] : null;

  const slash = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    // A field above 12 can only be a day; otherwise assume day-first.
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const candidate = `${slash[3]}-${pad(month)}-${pad(day)}`;
    return isRealDate(candidate) ? candidate : null;
  }

  const textual = new Date(raw);
  if (!Number.isNaN(textual.getTime())) {
    return `${textual.getUTCFullYear()}-${pad(textual.getUTCMonth() + 1)}-${pad(
      textual.getUTCDate(),
    )}`;
  }
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Trim, drop blanks, de-duplicate case-insensitively, keep first casing. */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function normalizeNames(value: unknown): string[] {
  return normalizeTags(value);
}

export interface ValidTransaction {
  date: string;
  merchant: string;
  category: string;
  amount: number;
  type: TxType;
  account: string;
  tags: string[];
  receipt: boolean;
  source: TxSource;
}

const SOURCES: TxSource[] = ["manual", "csv", "document", "google-drive"];

/**
 * Server-side validation for every write path. Returns either a normalized
 * transaction or a human-readable reason it was rejected.
 */
export function validateTransaction(
  input: unknown,
): { ok: true; value: ValidTransaction } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Transaction must be an object." };
  }
  const t = input as Partial<TransactionInput>;

  const date = normalizeDate(t.date);
  if (!date) return { ok: false, error: "A valid date is required." };

  const merchant =
    typeof t.merchant === "string" ? t.merchant.trim().slice(0, 200) : "";
  if (!merchant) return { ok: false, error: "A merchant or source is required." };

  const rawAmount = typeof t.amount === "string" ? Number(t.amount) : t.amount;
  if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount)) {
    return { ok: false, error: "Amount must be a finite number." };
  }
  const amount = Math.abs(Number(rawAmount.toFixed(2)));
  if (amount <= 0) return { ok: false, error: "Amount must be greater than 0." };

  const type: TxType = t.type === "income" ? "income" : "expense";
  if (t.type !== "income" && t.type !== "expense") {
    return { ok: false, error: "Type must be expense or income." };
  }

  const category =
    typeof t.category === "string" && t.category.trim()
      ? t.category.trim().slice(0, 80)
      : DEFAULT_CATEGORY;
  const account =
    typeof t.account === "string" && t.account.trim()
      ? t.account.trim().slice(0, 80)
      : DEFAULT_ACCOUNT;

  const source: TxSource =
    typeof t.source === "string" && SOURCES.includes(t.source as TxSource)
      ? (t.source as TxSource)
      : "manual";

  return {
    ok: true,
    value: {
      date,
      merchant,
      category,
      amount,
      type,
      account,
      tags: normalizeTags(t.tags).slice(0, 25),
      receipt: t.receipt === true,
      source,
    },
  };
}

/* -------------------------------------------------------------- rules engine */

/**
 * Rules are plain language: `whenText` names something the merchant/source
 * should contain, `thenText` names the category and/or tags to apply.
 * Examples:
 *   when "merchant contains netflix"  then "category: Subscriptions, tag: streaming"
 *   when "whole foods"                then "Groceries"
 */
export function ruleMatches(rule: Rule, merchant: string): boolean {
  const needle = parseWhen(rule.whenText);
  if (!needle) return false;
  return merchant.toLowerCase().includes(needle);
}

export function parseWhen(whenText: string): string {
  let text = whenText.toLowerCase().trim();
  text = text.replace(
    /^(when\s+)?(the\s+)?(merchant|description|payee|source|name)?\s*(text\s+)?(contains|includes|is|equals|matches|starts with|has)?\s*/,
    "",
  );
  text = text.replace(/^["'`]|["'`]$/g, "");
  return text.trim();
}

export function parseThen(thenText: string): {
  category?: string;
  tags: string[];
} {
  const text = thenText.trim();
  const tags: string[] = [];
  let category: string | undefined;

  const categoryMatch = text.match(
    /categor(?:y|ise|ize)[^a-z0-9]*(?:as|to|=|:)?\s*([^,;|]+)/i,
  );
  if (categoryMatch) category = categoryMatch[1].trim();

  const tagRegex = /tags?[^a-z0-9]*(?:as|to|with|=|:)?\s*([^,;|]+)/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(text)) !== null) {
    for (const piece of tagMatch[1].split(/[+&]/)) {
      const clean = piece.trim();
      if (clean) tags.push(clean);
    }
  }

  // No keywords at all: treat the whole instruction as a category name.
  if (!category && tags.length === 0 && text) category = text;

  return { category, tags: normalizeTags(tags) };
}

/**
 * Applies enabled rules to a transaction. Called only *after* duplicate
 * detection, so a rule can never cause a duplicate row to be inserted.
 */
export function applyRules(
  tx: ValidTransaction,
  rules: Rule[],
): ValidTransaction {
  let category = tx.category;
  const tags = [...tx.tags];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!ruleMatches(rule, tx.merchant)) continue;
    const then = parseThen(rule.thenText);
    if (then.category && category === DEFAULT_CATEGORY) category = then.category;
    for (const tag of then.tags) {
      if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    }
  }

  return { ...tx, category, tags: normalizeTags(tags) };
}

/* ------------------------------------------------------------------- files */

/** Filenames and Drive IDs are attacker-controlled; never build a key from raw input. */
export function safeSegment(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}
