import type { TransactionInput, TxType } from "../../shared/types";
import { DEFAULT_CATEGORY } from "../../shared/types";

/* ------------------------------------------------------------------ parsing */

/** RFC-4180-ish parser: handles quoted fields, escaped quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const clean = text.replace(/^﻿/, "");

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === "," || char === "\t") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/* ------------------------------------------------------------ column mapping */

export type ColumnRole =
  | "date"
  | "merchant"
  | "amount"
  | "debit"
  | "credit"
  | "category"
  | "account"
  | "ignore";

export interface ColumnMapping {
  [columnIndex: number]: ColumnRole;
}

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[().,/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasWord(header: string, word: string): boolean {
  return new RegExp(`(^| )${word}( |$)`).test(header);
}

/**
 * Recognizes the column names Indian bank and card exports actually use —
 * HDFC's "Withdrawal Amt." / "Deposit Amt.", ICICI's "Transaction Remarks",
 * SBI's "Particulars", plus the generic English headings.
 *
 * Order matters: balance columns are excluded first so a running balance is
 * never mistaken for an amount, and debit/credit are matched before the
 * generic "amount" so "Withdrawal Amt." lands on debit.
 */
function roleForHeader(raw: string): ColumnRole {
  const h = normalizeHeader(raw);
  if (!h) return "ignore";

  // A running/closing balance is not a transaction amount.
  if (h.includes("balance") || hasWord(h, "bal")) return "ignore";
  if (h.includes("ref") || h.includes("chq") || h.includes("cheque")) return "ignore";

  if (
    h.includes("withdrawal") ||
    h.includes("debit") ||
    h.includes("paid out") ||
    h.includes("money out") ||
    hasWord(h, "dr")
  ) {
    return "debit";
  }
  if (
    h.includes("deposit") ||
    h.includes("credit") ||
    h.includes("paid in") ||
    h.includes("money in") ||
    hasWord(h, "cr")
  ) {
    return "credit";
  }
  if (h.includes("category") || h.includes("classification")) return "category";
  if (h.includes("account") || hasWord(h, "card") || hasWord(h, "source")) {
    return "account";
  }
  // "Value Dt" is a date, not a value — check this before the amount fallback.
  if (h.includes("date") || hasWord(h, "dt")) return "date";
  if (
    h.includes("narration") ||
    h.includes("particulars") ||
    h.includes("description") ||
    h.includes("remarks") ||
    h.includes("narrative") ||
    h.includes("details") ||
    h.includes("merchant") ||
    h.includes("payee") ||
    h.includes("memo") ||
    hasWord(h, "name")
  ) {
    return "merchant";
  }
  if (h.includes("amount") || hasWord(h, "amt") || hasWord(h, "value")) {
    return "amount";
  }
  return "ignore";
}

export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<ColumnRole>();

  headers.forEach((header, index) => {
    const role = roleForHeader(header);
    if (role !== "ignore" && !used.has(role)) {
      mapping[index] = role;
      used.add(role);
    } else {
      mapping[index] = "ignore";
    }
  });

  return mapping;
}

/** Enough information to import without guessing silently. */
export function mappingIsComplete(mapping: ColumnMapping): boolean {
  const roles = Object.values(mapping);
  const hasDate = roles.includes("date");
  const hasMerchant = roles.includes("merchant");
  const hasValue =
    roles.includes("amount") ||
    roles.includes("debit") ||
    roles.includes("credit");
  return hasDate && hasMerchant && hasValue;
}

/** Rows whose first line does not parse as data are treated as a header row. */
export function looksLikeHeader(row: string[]): boolean {
  const numeric = row.filter((cell) => parseAmount(cell) !== null).length;
  const dated = row.filter((cell) => parseCsvDate(cell) !== null).length;
  return numeric === 0 && dated === 0;
}

/**
 * Finds the real header row.
 *
 * Bank statements — spreadsheets especially — open with the account holder's
 * name, account number, statement period and blank lines before the column
 * names. Assuming row 1 is the header leaves every column unmapped, so instead
 * score the first several rows by how many columns they identify and take the
 * best one.
 */
export function findHeaderRow(
  rows: string[][],
  searchDepth = 15,
): { index: number; hasHeader: boolean } {
  let bestIndex = -1;
  let bestScore = 0;

  const limit = Math.min(searchDepth, rows.length);
  for (let i = 0; i < limit; i++) {
    const mapping = guessMapping(rows[i]);
    const roles = new Set(
      Object.values(mapping).filter((role) => role !== "ignore"),
    );
    const hasDate = roles.has("date");
    const hasMerchant = roles.has("merchant");
    const hasValue =
      roles.has("amount") || roles.has("debit") || roles.has("credit");

    // A header must name at least a date, a description and a money column
    // between them; otherwise it is data or a title line.
    if (!(hasDate && hasMerchant && hasValue)) continue;

    const score = roles.size;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0) return { index: bestIndex, hasHeader: true };

  // No recognisable header: fall back to the old first-row heuristic.
  return { index: 0, hasHeader: rows.length > 0 && looksLikeHeader(rows[0]) };
}

/* ------------------------------------------------------------------ helpers */

/**
 * Reads one amount cell. Handles the shapes Indian bank and card statements
 * actually use: `₹1,57,500.00`, `Rs. 2,499`, `5,000.00 Dr`, `(250.00)`, `-250`.
 * A `Dr` marker returns a negative number and `Cr` a positive one, so the
 * signed-amount column maps them to expense / income like any other statement.
 */
export function parseAmount(value: string): number | null {
  if (typeof value !== "string") return null;
  let raw = value.trim();
  if (!raw) return null;

  let negative = false;

  // Dr / Cr markers, leading or trailing.
  const drCr = raw.match(/(^|\s)(dr|cr)\.?($|\s)/i);
  if (drCr) {
    negative = drCr[2].toLowerCase() === "dr";
    raw = raw.replace(/(^|\s)(dr|cr)\.?($|\s)/i, " ").trim();
  }

  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1);
  }

  raw = raw
    .replace(/₹/g, "")
    .replace(/\bINR\b/gi, "")
    .replace(/\bRs\.?/gi, "")
    .replace(/[$£€¥]/g, "")
    .trim();

  if (raw.startsWith("-")) {
    negative = true;
    raw = raw.slice(1);
  } else if (raw.startsWith("+")) {
    raw = raw.slice(1);
  }

  raw = raw.replace(/,/g, "").trim();
  if (!raw || !/^\d*\.?\d+$/.test(raw)) return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects calendar-impossible dates like 31/02, which would otherwise roll over. */
function isRealDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * Indian statements are day-first (05/07/2026 is 5 July), so that is the
 * default. Pass `dayFirst: false` for a month-first statement; the import
 * dialog exposes this because guessing wrong silently misdates a whole file.
 */
export function parseCsvDate(value: string, dayFirst = true): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (ISO.test(raw)) return raw;

  const slash = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const yearRaw = slash[3];
    const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    // A field above 12 can only be a day, whatever the stated convention.
    let day: number;
    let month: number;
    if (a > 12) [day, month] = [a, b];
    else if (b > 12) [day, month] = [b, a];
    else [day, month] = dayFirst ? [a, b] : [b, a];
    return isRealDate(year, month, day);
  }

  // "5 Jul 2026" / "05-Jul-26" — common on Indian bank exports.
  const textual = raw.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{2}|\d{4})$/);
  if (textual) {
    const day = Number(textual[1]);
    const monthIndex = MONTHS.indexOf(textual[2].slice(0, 3).toLowerCase());
    const yearRaw = textual[3];
    const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    if (monthIndex >= 0) return isRealDate(year, monthIndex + 1, day);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(parsed.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ mapping */

export interface CsvConversion {
  transactions: TransactionInput[];
  /** Lines that could not be parsed. They are reported, never imported as placeholders. */
  unparseable: number;
}

/**
 * Turns parsed rows into transactions using the confirmed mapping.
 * Honors the statement's own sign convention: debits/negatives are expenses,
 * credits/positives are income. Amounts are stored as positive magnitudes.
 */
export function rowsToTransactions(
  rows: string[][],
  mapping: ColumnMapping,
  options: {
    knownCategories: string[];
    fallbackAccount: string;
    dayFirst?: boolean;
  },
): CsvConversion {
  const dayFirst = options.dayFirst ?? true;
  const indexOf = (role: ColumnRole): number => {
    const found = Object.entries(mapping).find(([, r]) => r === role);
    return found ? Number(found[0]) : -1;
  };

  const dateIdx = indexOf("date");
  const merchantIdx = indexOf("merchant");
  const amountIdx = indexOf("amount");
  const debitIdx = indexOf("debit");
  const creditIdx = indexOf("credit");
  const categoryIdx = indexOf("category");
  const accountIdx = indexOf("account");

  const categoryLookup = new Map(
    options.knownCategories.map((c) => [c.toLowerCase(), c]),
  );

  const transactions: TransactionInput[] = [];
  let unparseable = 0;

  for (const row of rows) {
    const date =
      dateIdx >= 0 ? parseCsvDate(row[dateIdx] ?? "", dayFirst) : null;
    const merchant =
      merchantIdx >= 0 ? (row[merchantIdx] ?? "").trim() : "";

    let amount: number | null = null;
    let type: TxType = "expense";

    const debit = debitIdx >= 0 ? parseAmount(row[debitIdx] ?? "") : null;
    const credit = creditIdx >= 0 ? parseAmount(row[creditIdx] ?? "") : null;

    if (debit !== null && Math.abs(debit) > 0) {
      amount = Math.abs(debit);
      type = "expense";
    } else if (credit !== null && Math.abs(credit) > 0) {
      amount = Math.abs(credit);
      type = "income";
    } else if (amountIdx >= 0) {
      const parsed = parseAmount(row[amountIdx] ?? "");
      if (parsed !== null && parsed !== 0) {
        amount = Math.abs(parsed);
        type = parsed < 0 ? "expense" : "income";
      }
    }

    if (!date || !merchant || amount === null || amount <= 0) {
      unparseable += 1;
      continue;
    }

    const rawCategory =
      categoryIdx >= 0 ? (row[categoryIdx] ?? "").trim() : "";
    const category =
      categoryLookup.get(rawCategory.toLowerCase()) ?? DEFAULT_CATEGORY;

    const rawAccount = accountIdx >= 0 ? (row[accountIdx] ?? "").trim() : "";

    transactions.push({
      date,
      merchant: merchant.slice(0, 200),
      amount,
      type,
      category,
      account: rawAccount || options.fallbackAccount,
      tags: [],
      receipt: false,
      source: "csv",
    });
  }

  return { transactions, unparseable };
}

export const COLUMN_ROLE_LABELS: Array<{ value: ColumnRole; label: string }> = [
  { value: "ignore", label: "Ignore this column" },
  { value: "date", label: "Date" },
  { value: "merchant", label: "Merchant / description" },
  { value: "amount", label: "Amount (signed)" },
  { value: "debit", label: "Debit / money out" },
  { value: "credit", label: "Credit / money in" },
  { value: "category", label: "Category" },
  { value: "account", label: "Account" },
];
