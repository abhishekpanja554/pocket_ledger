import type { Cadence, Transaction } from "../../shared/types";

/* --------------------------------------------------- merchant normalization */

/**
 * Normalizes a merchant for *pattern matching only*. The transaction keeps its
 * original display merchant.
 */
export function normalizeMerchant(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/#\s*\d+\s*$/, "") // terminal store number, e.g. "Target #1043"
    .replace(/\b\d{4,}\b/g, " ") // long reference numbers
    .replace(/[^a-z0-9\s]+/g, " ") // punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ cadence */

interface CadenceWindow {
  cadence: Cadence;
  min: number;
  max: number;
}

const CADENCE_WINDOWS: CadenceWindow[] = [
  { cadence: "weekly", min: 5, max: 9 },
  { cadence: "biweekly", min: 12, max: 17 },
  { cadence: "monthly", min: 24, max: 40 },
  { cadence: "quarterly", min: 75, max: 110 },
  { cadence: "annual", min: 330, max: 400 },
];

export function classifyInterval(days: number): Cadence | null {
  const match = CADENCE_WINDOWS.find((w) => days >= w.min && days <= w.max);
  return match ? match.cadence : null;
}

export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

/** Spec §9.6 conversion table. */
export function monthlyEquivalent(amount: number, cadence: Cadence): number {
  switch (cadence) {
    case "weekly":
      return (amount * 52) / 12;
    case "biweekly":
      return (amount * 26) / 12;
    case "monthly":
      return amount;
    case "quarterly":
      return amount / 3;
    case "annual":
      return amount / 12;
  }
}

export function annualEquivalent(amount: number, cadence: Cadence): number {
  return monthlyEquivalent(amount, cadence) * 12;
}

/* --------------------------------------------------------------- hint lists */

const SUBSCRIPTION_HINTS = [
  "netflix",
  "spotify",
  "hulu",
  "disney",
  "youtube",
  "icloud",
  "dropbox",
  "adobe",
  "microsoft",
  "amazon prime",
  "patreon",
  "membership",
  "studio",
  "gym",
  "openai",
  "chatgpt",
  "canva",
  "notion",
  "zoom",
  "slack",
  "github",
];

const RECURRING_HINTS = [
  "mortgage",
  "rent",
  "loan",
  "insurance",
  "utility",
  "utilities",
  "electric",
  "water",
  "internet",
  "phone",
  "mobile",
  "daycare",
  "tuition",
  "lease",
  "car payment",
  "auto payment",
  "hoa",
  "property tax",
];

function containsHint(haystack: string, hints: string[]): boolean {
  return hints.some((hint) => haystack.includes(hint));
}

/* ---------------------------------------------------------------- date math */

export function parseISO(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Adds months while preserving day-of-month, clamping to the month's length. */
export function addMonthsPreservingDay(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

export function advance(date: Date, cadence: Cadence): Date {
  switch (cadence) {
    case "weekly":
      return new Date(date.getTime() + 7 * 86_400_000);
    case "biweekly":
      return new Date(date.getTime() + 14 * 86_400_000);
    case "monthly":
      return addMonthsPreservingDay(date, 1);
    case "quarterly":
      return addMonthsPreservingDay(date, 3);
    case "annual":
      return addMonthsPreservingDay(date, 12);
  }
}

/** Calendar-aware next occurrence strictly after today. */
export function nextOccurrence(lastDate: string, cadence: Cadence): string {
  const today = parseISO(toISO(new Date()));
  let next = advance(parseISO(lastDate), cadence);
  let guard = 0;
  while (next.getTime() <= today.getTime() && guard < 400) {
    next = advance(next, cadence);
    guard += 1;
  }
  return toISO(next);
}

/* ------------------------------------------------------------- the detector */

export type PatternKind = "subscription" | "recurring";
export type Confidence = "high" | "likely";

export interface DetectedPattern {
  key: string;
  kind: PatternKind;
  merchant: string;
  normalized: string;
  category: string;
  cadence: Cadence;
  occurrences: number;
  averageAmount: number;
  variation: number;
  confidence: Confidence;
  nextDate: string;
  lastDate: string;
  monthlyEquivalent: number;
  account?: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Detects recurring payments and subscriptions from real expense transactions
 * only. Nothing is ever confirmed automatically — the user chooses Keep.
 */
export function detectPatterns(transactions: Transaction[]): DetectedPattern[] {
  const groups = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    if (tx.type !== "expense") continue;
    const normalized = normalizeMerchant(tx.merchant);
    if (!normalized) continue;
    const bucket = groups.get(normalized);
    if (bucket) bucket.push(tx);
    else groups.set(normalized, [tx]);
  }

  const patterns: DetectedPattern[] = [];

  for (const [normalized, group] of groups) {
    // Require at least two *unique* dates.
    const byDate = new Map<string, Transaction>();
    for (const tx of group) if (!byDate.has(tx.date)) byDate.set(tx.date, tx);
    const dates = [...byDate.keys()].sort();
    if (dates.length < 2) continue;

    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push(daysBetween(parseISO(dates[i - 1]), parseISO(dates[i])));
    }
    const dominant = median(intervals);
    const cadence = classifyInterval(dominant);
    if (!cadence) continue;

    const amounts = group.map((tx) => tx.amount);
    const average = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (average <= 0) continue;
    const variation =
      Math.max(...amounts.map((a) => Math.abs(a - average))) / average;

    const haystack = [
      normalized,
      ...group.map((tx) => tx.category.toLowerCase()),
      ...group.flatMap((tx) => tx.tags.map((t) => t.toLowerCase())),
    ].join(" ");

    const subscriptionHinted =
      haystack.includes("subscription") ||
      containsHint(normalized, SUBSCRIPTION_HINTS);
    const recurringHinted = containsHint(haystack, RECURRING_HINTS);

    let kind: PatternKind;
    if (subscriptionHinted) kind = "subscription";
    else if (recurringHinted) kind = "recurring";
    else {
      // Spec §9.5 — no strong hint means a much stricter bar, so routine
      // weekly grocery runs are never suggested.
      const strictCadence =
        cadence === "monthly" || cadence === "quarterly" || cadence === "annual";
      if (!strictCadence || group.length < 3 || variation > 0.03) continue;
      kind = "recurring";
    }

    const variationLimit = kind === "subscription" ? 0.2 : 0.35;
    if (variation > variationLimit) continue;

    const jitter = Math.max(...intervals.map((i) => Math.abs(i - dominant)));
    const confidence: Confidence =
      group.length >= 3 && variation <= 0.12 && jitter <= 5 ? "high" : "likely";

    const lastDate = dates[dates.length - 1];
    const latest = byDate.get(lastDate)!;

    patterns.push({
      key: normalized,
      kind,
      merchant: latest.merchant,
      normalized,
      category: latest.category,
      cadence,
      occurrences: group.length,
      averageAmount: average,
      variation,
      confidence,
      nextDate: nextOccurrence(lastDate, cadence),
      lastDate,
      monthlyEquivalent: monthlyEquivalent(average, cadence),
      account: latest.account,
    });
  }

  return patterns.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
}

/** Removes suggestions the user dismissed or already confirmed. */
export function visibleSuggestions(
  patterns: DetectedPattern[],
  dismissed: string[],
  confirmedNames: string[],
): DetectedPattern[] {
  const dismissedSet = new Set(dismissed.map((d) => d.toLowerCase()));
  const confirmedSet = new Set(
    confirmedNames.map((name) => normalizeMerchant(name)).filter(Boolean),
  );
  return patterns.filter(
    (p) => !dismissedSet.has(p.key.toLowerCase()) && !confirmedSet.has(p.key),
  );
}
