import {
  PERIOD_IDS,
  type Budget,
  type Cadence,
  type Goal,
  type PeriodId,
  type RecurringEntry,
  type Rule,
  type SubscriptionEntry,
} from "../shared/types";
import type { Env } from "./db";
import { normalizeNames, normalizeTags, uuid } from "./util";

const CADENCES: Cadence[] = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annual",
];

function str(value: unknown, fallback = "", max = 120): string {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function money(value: unknown): number {
  return Math.max(0, Number(num(value, 0).toFixed(2)));
}

function isoDateOrUndefined(value: unknown): string | undefined {
  const s = str(value, "", 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

function cadence(value: unknown): Cadence {
  return CADENCES.includes(value as Cadence) ? (value as Cadence) : "monthly";
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, 500) : [];
}

/* --------------------------------------------------------------- validators */

export function normalizeGoals(value: unknown): Goal[] {
  return arr(value)
    .map((raw): Goal | null => {
      const g = raw as Partial<Goal>;
      const name = str(g.name);
      if (!name) return null;
      return {
        id: str(g.id) || uuid(),
        name,
        target: money(g.target),
        current: money(g.current),
        dueDate: isoDateOrUndefined(g.dueDate),
        note: str(g.note, "", 400) || undefined,
        createdAt: str(g.createdAt) || new Date().toISOString(),
      };
    })
    .filter((g): g is Goal => g !== null);
}

export function normalizeBudgets(value: unknown): Budget[] {
  return arr(value)
    .map((raw): Budget | null => {
      const b = raw as Partial<Budget>;
      const category = str(b.category);
      if (!category) return null;
      return {
        id: str(b.id) || uuid(),
        category,
        limit: money(b.limit),
        active: b.active !== false,
        createdAt: str(b.createdAt) || new Date().toISOString(),
      };
    })
    .filter((b): b is Budget => b !== null);
}

export function normalizeRecurring(value: unknown): RecurringEntry[] {
  return arr(value)
    .map((raw): RecurringEntry | null => {
      const r = raw as Partial<RecurringEntry>;
      const name = str(r.name);
      if (!name) return null;
      return {
        id: str(r.id) || uuid(),
        name,
        category: str(r.category) || "Other",
        amount: money(r.amount),
        cadence: cadence(r.cadence),
        nextDate: isoDateOrUndefined(r.nextDate) ?? "",
        account: str(r.account) || undefined,
        active: r.active !== false,
        createdAt: str(r.createdAt) || new Date().toISOString(),
      };
    })
    .filter((r): r is RecurringEntry => r !== null);
}

export function normalizeSubscriptions(value: unknown): SubscriptionEntry[] {
  return arr(value)
    .map((raw): SubscriptionEntry | null => {
      const s = raw as Partial<SubscriptionEntry>;
      const name = str(s.name);
      if (!name) return null;
      return {
        id: str(s.id) || uuid(),
        name,
        group: str(s.group) || "Subscriptions",
        amount: money(s.amount),
        cadence: cadence(s.cadence),
        nextRenewal: isoDateOrUndefined(s.nextRenewal) ?? "",
        account: str(s.account) || undefined,
        active: s.active !== false,
        createdAt: str(s.createdAt) || new Date().toISOString(),
      };
    })
    .filter((s): s is SubscriptionEntry => s !== null);
}

export function normalizeRules(value: unknown): Rule[] {
  return arr(value)
    .map((raw): Rule | null => {
      const r = raw as Partial<Rule>;
      const whenText = str(r.whenText, "", 200);
      const thenText = str(r.thenText, "", 200);
      if (!whenText || !thenText) return null;
      return {
        id: str(r.id) || uuid(),
        whenText,
        thenText,
        enabled: r.enabled !== false,
        createdAt: str(r.createdAt) || new Date().toISOString(),
      };
    })
    .filter((r): r is Rule => r !== null);
}

function period(value: unknown): PeriodId {
  return PERIOD_IDS.includes(value as PeriodId)
    ? (value as PeriodId)
    : "all-time";
}

/* ------------------------------------------------------------------ writing */

/**
 * Builds the list of settings rows to write from a partial request body.
 * Only keys actually present in the request are returned, so updating one
 * preference group never resets another.
 */
export function collectSettingUpdates(
  body: Record<string, unknown>,
): Array<[string, unknown]> {
  const updates: Array<[string, unknown]> = [];
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  if (has("categories")) updates.push(["categories", normalizeNames(body.categories)]);
  if (has("accounts")) updates.push(["accounts", normalizeNames(body.accounts)]);
  if (has("goals")) updates.push(["goals", normalizeGoals(body.goals)]);
  if (has("budgets")) updates.push(["budgets", normalizeBudgets(body.budgets)]);
  if (has("subscriptions"))
    updates.push(["subscriptions", normalizeSubscriptions(body.subscriptions)]);
  if (has("recurring")) updates.push(["recurring", normalizeRecurring(body.recurring)]);
  if (has("dismissedPatterns"))
    updates.push(["dismissedPatterns", normalizeTags(body.dismissedPatterns)]);
  if (has("assets")) updates.push(["assets", money(body.assets)]);
  if (has("liabilities")) updates.push(["liabilities", money(body.liabilities)]);
  if (has("netWorthConfigured"))
    updates.push(["netWorthConfigured", body.netWorthConfigured === true]);
  if (has("selectedPeriod"))
    updates.push(["selectedPeriod", period(body.selectedPeriod)]);
  if (has("driveFolder")) {
    const f = body.driveFolder as Record<string, unknown> | null;
    updates.push([
      "driveFolder",
      f && str(f.id)
        ? { id: str(f.id), name: str(f.name) || "Ledgerly Financial Inbox", url: str(f.url, "", 400) }
        : null,
    ]);
  }
  if (has("driveSchedule")) {
    const s = body.driveSchedule as Record<string, unknown>;
    updates.push([
      "driveSchedule",
      {
        time: /^\d{2}:\d{2}$/.test(str(s?.time)) ? str(s.time) : "08:00",
        timezone: str(s?.timezone, "UTC", 64),
        cadence: "daily",
      },
    ]);
  }
  if (has("freshStart")) updates.push(["freshStart", body.freshStart === true]);

  return updates;
}

/** Replaces the tag definition table with the supplied list. */
export async function replaceTags(env: Env, names: string[]): Promise<void> {
  const normalized = normalizeTags(names);
  const now = new Date().toISOString();
  const statements = [
    ...(normalized.length
      ? [
          env.DB.prepare(
            `DELETE FROM tags WHERE lower(name) NOT IN (${normalized
              .map(() => "?")
              .join(",")})`,
          ).bind(...normalized.map((n) => n.toLowerCase())),
        ]
      : [env.DB.prepare(`DELETE FROM tags`)]),
    ...normalized.map((name) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO tags (name, createdAt) VALUES (?, ?)`,
      ).bind(name, now),
    ),
  ];
  await env.DB.batch(statements);
}

/** Replaces the rules table with the supplied list. */
export async function replaceRules(env: Env, rules: Rule[]): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM rules`),
    ...rules.map((r) =>
      env.DB.prepare(
        `INSERT INTO rules (id, whenText, thenText, enabled, createdAt) VALUES (?, ?, ?, ?, ?)`,
      ).bind(r.id, r.whenText, r.thenText, r.enabled ? 1 : 0, r.createdAt),
    ),
  ]);
}

/** Removes tag names from every historical transaction (explicit user action). */
export async function stripTagsFromTransactions(
  env: Env,
  names: string[],
): Promise<number> {
  const targets = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  if (targets.size === 0) return 0;

  const { results } = await env.DB.prepare(
    `SELECT id, tags FROM transactions WHERE tags != '[]'`,
  ).all<{ id: string; tags: string }>();

  const updates: D1PreparedStatement[] = [];
  for (const row of results ?? []) {
    let parsed: string[];
    try {
      parsed = JSON.parse(row.tags);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const kept = parsed.filter((t) => !targets.has(String(t).trim().toLowerCase()));
    if (kept.length !== parsed.length) {
      updates.push(
        env.DB.prepare(`UPDATE transactions SET tags = ? WHERE id = ?`).bind(
          JSON.stringify(kept),
          row.id,
        ),
      );
    }
  }
  if (updates.length) await env.DB.batch(updates);
  return updates.length;
}
