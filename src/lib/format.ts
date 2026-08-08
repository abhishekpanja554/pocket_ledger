/**
 * Pocket Ledger is set up for Indian rupees. `en-IN` gives the lakh/crore digit
 * grouping Indian statements use — ₹1,57,500.00, not ₹157,500.00.
 */
export const LOCALE = "en-IN";
export const CURRENCY = "INR";

const currency = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
});

const currencyCompact = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  maximumFractionDigits: 0,
});

/** Short axis labels: ₹1.5L, ₹1.2Cr — full amounts would clip a chart gutter. */
const currencyAxis = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  notation: "compact",
  maximumFractionDigits: 1,
});

export function money(value: number): string {
  return currency.format(Number.isFinite(value) ? value : 0);
}

export function moneyCompact(value: number): string {
  return currencyCompact.format(Number.isFinite(value) ? value : 0);
}

export function moneyAxis(value: number): string {
  return currencyAxis.format(Number.isFinite(value) ? value : 0);
}

/** Expenses read as -₹12.00, income as +₹12.00. */
export function signedMoney(amount: number, type: "expense" | "income"): string {
  return `${type === "income" ? "+" : "-"}${money(Math.abs(amount))}`;
}

export function percent(value: number, digits = 0): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(digits)}%`;
}

/** Savings rate; guards against division by zero per spec §6.2. */
export function savingsRate(income: number, spending: number): number {
  if (!income || income <= 0) return 0;
  return ((income - spending) / income) * 100;
}

export function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateShort(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatTimestamp(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(now.getDate()).padStart(2, "0")}`;
}

export function daysUntil(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = new Date();
  const start = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.round((target - start) / 86_400_000);
}

export function relativeDueLabel(iso: string): string {
  const days = daysUntil(iso);
  if (days === null) return "";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

export function fileKind(mimeType: string, filename: string): string {
  const name = filename.toLowerCase();
  if (mimeType.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.includes("csv") || name.endsWith(".csv")) return "CSV";
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls")
  )
    return "Spreadsheet";
  if (mimeType.startsWith("text/")) return "Text";
  return "Document";
}
