import type { PeriodId, Transaction } from "../../shared/types";

export interface PeriodOption {
  id: PeriodId;
  label: string;
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { id: "all-time", label: "All time" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-3-months", label: "Last 3 months" },
  { id: "last-6-months", label: "Last 6 months" },
  { id: "this-year", label: "This year" },
];

export function periodLabel(id: PeriodId): string {
  return PERIOD_OPTIONS.find((p) => p.id === id)?.label ?? "All time";
}

export interface DateRange {
  /** Inclusive ISO start date, or null for "no cutoff". */
  start: string | null;
  /** Inclusive ISO end date. */
  end: string;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `today` arrives as a genuine "now" instant in the browser's local timezone
 * (IST). Reading it with UTC getters — or round-tripping it through
 * `toISOString()` — shifts the calendar date backward for roughly 5.5 hours
 * every day (IST midnight to 5:30 AM, UTC's date is still "yesterday"),
 * which silently excluded same-day transactions from every period filter,
 * "All time" included. Normalizing to a UTC-midnight stand-in for the same
 * *local* calendar date keeps all the UTC-domain month-boundary arithmetic
 * below correct while fixing that one mismatch.
 */
function normalizeToLocalCalendarDate(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function startOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

function endOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0));
}

/**
 * "All time" deliberately has no start cutoff: every saved transaction through
 * today is included.
 */
export function rangeFor(period: PeriodId, today = new Date()): DateRange {
  const normalized = normalizeToLocalCalendarDate(today);
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth();
  const end = iso(normalized);

  switch (period) {
    case "this-month":
      return { start: iso(startOfMonth(y, m)), end };
    case "last-month":
      return {
        start: iso(startOfMonth(y, m - 1)),
        end: iso(endOfMonth(y, m - 1)),
      };
    case "last-3-months":
      return { start: iso(startOfMonth(y, m - 2)), end };
    case "last-6-months":
      return { start: iso(startOfMonth(y, m - 5)), end };
    case "this-year":
      return { start: iso(new Date(Date.UTC(y, 0, 1))), end };
    case "all-time":
    default:
      return { start: null, end };
  }
}

export function inRange(date: string, range: DateRange): boolean {
  if (range.start && date < range.start) return false;
  return date <= range.end;
}

export function filterByPeriod(
  transactions: Transaction[],
  period: PeriodId,
  today = new Date(),
): Transaction[] {
  const range = rangeFor(period, today);
  return transactions.filter((tx) => inRange(tx.date, range));
}

/**
 * The equivalent window immediately before the selected one. Used only to show
 * a comparison when real data exists on both sides — never to invent a trend.
 */
export function priorRangeFor(
  period: PeriodId,
  today = new Date(),
): DateRange | null {
  const normalized = normalizeToLocalCalendarDate(today);
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth();

  switch (period) {
    case "this-month":
      return {
        start: iso(startOfMonth(y, m - 1)),
        end: iso(endOfMonth(y, m - 1)),
      };
    case "last-month":
      return {
        start: iso(startOfMonth(y, m - 2)),
        end: iso(endOfMonth(y, m - 2)),
      };
    case "last-3-months":
      return {
        start: iso(startOfMonth(y, m - 5)),
        end: iso(endOfMonth(y, m - 3)),
      };
    case "last-6-months":
      return {
        start: iso(startOfMonth(y, m - 11)),
        end: iso(endOfMonth(y, m - 6)),
      };
    case "this-year":
      return {
        start: iso(new Date(Date.UTC(y - 1, 0, 1))),
        end: iso(new Date(Date.UTC(y - 1, 11, 31))),
      };
    case "all-time":
    default:
      return null;
  }
}
