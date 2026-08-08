import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Landmark,
  Lightbulb,
  PieChart,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useMemo } from "react";
import type { Transaction } from "../../shared/types";
import { useUi } from "../App";
import { CashFlowChart, CategoryDonut, type CashFlowPoint } from "../components/charts";
import { PeriodSelector } from "../components/PeriodSelector";
import { Card, CardHead, EmptyState } from "../components/ui";
import {
  LOCALE,
  formatDate,
  money,
  percent,
  relativeDueLabel,
  savingsRate,
  signedMoney,
} from "../lib/format";
import { filterByPeriod, inRange, periodLabel, priorRangeFor } from "../lib/period";
import { detectPatterns, visibleSuggestions } from "../lib/recurring";
import { useAppState } from "../store";

export function Dashboard() {
  const state = useAppState();
  const { navigate } = useUi();
  const { settings, transactions } = state;
  const period = settings.selectedPeriod;

  const inPeriod = useMemo(
    () => filterByPeriod(transactions, period),
    [transactions, period],
  );

  const income = sum(inPeriod.filter((tx) => tx.type === "income"));
  const spending = sum(inPeriod.filter((tx) => tx.type === "expense"));
  const rate = savingsRate(income, spending);

  const prior = useMemo(() => {
    const range = priorRangeFor(period);
    if (!range) return null;
    const rows = transactions.filter((tx) => inRange(tx.date, range));
    if (rows.length === 0) return null;
    return {
      income: sum(rows.filter((tx) => tx.type === "income")),
      spending: sum(rows.filter((tx) => tx.type === "expense")),
    };
  }, [transactions, period]);

  const netWorth = settings.assets - settings.liabilities;

  const cashFlow = useMemo(() => buildCashFlow(inPeriod), [inPeriod]);
  const categorySlices = useMemo(() => buildCategorySlices(inPeriod), [inPeriod]);
  const recent = useMemo(
    () =>
      [...inPeriod]
        .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)))
        .slice(0, 5),
    [inPeriod],
  );

  const needsReview = transactions.filter(
    (tx) => tx.category === "Needs review",
  ).length;

  const upcoming = useMemo(() => {
    const detected = visibleSuggestions(
      detectPatterns(transactions),
      settings.dismissedPatterns,
      [
        ...settings.recurring.map((r) => r.name),
        ...settings.subscriptions.map((s) => s.name),
      ],
    );
    const confirmed = [
      ...settings.recurring
        .filter((r) => r.active && r.nextDate)
        .map((r) => ({ name: r.name, date: r.nextDate, amount: r.amount, kind: "Recurring" })),
      ...settings.subscriptions
        .filter((s) => s.active && s.nextRenewal)
        .map((s) => ({
          name: s.name,
          date: s.nextRenewal,
          amount: s.amount,
          kind: "Subscription",
        })),
    ];
    // Detected-but-unconfirmed items are shown only as suggestions elsewhere;
    // "Coming up" lists confirmed commitments so nothing here is speculative.
    void detected;
    return confirmed
      .filter((item) => item.date >= new Date().toISOString().slice(0, 10))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 4);
  }, [transactions, settings]);

  const totalCount = transactions.length;

  return (
    <div className="stack">
      <div className="row row--between">
        <div>
          <h2 className="section-title">Overview</h2>
          <p className="page-intro">
            Showing {periodLabel(period)} · {inPeriod.length} transaction
            {inPeriod.length === 1 ? "" : "s"}
          </p>
        </div>
        <PeriodSelector align="right" />
      </div>

      <div className="grid grid--4">
        <article className="summary-card summary-card--navy">
          <header className="summary-card__head">
            <span className="summary-card__icon" aria-hidden="true">
              <Landmark size={16} />
            </span>
            Net worth
          </header>
          {settings.netWorthConfigured ? (
            <>
              <p className="summary-card__value">{money(netWorth)}</p>
              <p className="calc-strip">
                <span className="calc-strip__label">Calculation</span>
                <span>
                  {money(settings.assets)} assets − {money(settings.liabilities)}{" "}
                  liabilities
                </span>
              </p>
            </>
          ) : (
            <>
              <p className="summary-card__value summary-card__value--muted">
                Not set
              </p>
              <p className="calc-strip">
                <span className="calc-strip__label">Net worth</span>
                <span>
                  is your assets minus liabilities — not this period's income
                  minus spending.
                </span>
              </p>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => navigate("settings")}
              >
                Set it up in Settings
              </button>
            </>
          )}
        </article>

        <article className="summary-card">
          <header className="summary-card__head">
            <span
              className="summary-card__icon summary-card__icon--green"
              aria-hidden="true"
            >
              <TrendingUp size={16} />
            </span>
            Income
          </header>
          <p className="summary-card__value">{money(income)}</p>
          <TrendStrip
            label="vs previous period"
            current={income}
            previous={prior?.income ?? null}
            positiveIsGood
          />
        </article>

        <article className="summary-card">
          <header className="summary-card__head">
            <span
              className="summary-card__icon summary-card__icon--orange"
              aria-hidden="true"
            >
              <TrendingDown size={16} />
            </span>
            Spending
          </header>
          <p className="summary-card__value">{money(spending)}</p>
          <TrendStrip
            label="vs previous period"
            current={spending}
            previous={prior?.spending ?? null}
            positiveIsGood={false}
          />
        </article>

        <article className="summary-card">
          <header className="summary-card__head">
            <span
              className="summary-card__icon summary-card__icon--blue"
              aria-hidden="true"
            >
              <Wallet size={16} />
            </span>
            Savings rate
          </header>
          <p className="summary-card__value">{percent(rate)}</p>
          <p className="calc-strip">
            <span className="calc-strip__label">Calculation</span>
            <span>
              {income > 0
                ? `(${money(income)} − ${money(spending)}) ÷ ${money(income)}`
                : "No income recorded in this period, so the rate shows 0%."}
            </span>
          </p>
        </article>
      </div>

      <div className="grid grid--dash">
        <Card>
          <CardHead
            title="Cash flow"
            hint="Monthly income and spending from your saved transactions."
          />
          {cashFlow.length === 0 ? (
            <EmptyState
              icon={<TrendingUp size={20} />}
              title="No cash flow yet"
              text="Import or add transactions to see cash flow."
            />
          ) : (
            <CashFlowChart points={cashFlow} />
          )}
        </Card>

        <Card>
          <CardHead
            title="Spending by category"
            hint={`Expenses in ${periodLabel(period).toLowerCase()}.`}
          />
          {categorySlices.slices.length === 0 ? (
            <EmptyState
              icon={<PieChart size={20} />}
              title="No spending to group yet"
              text="Once expenses are saved, they are grouped by category here."
            />
          ) : (
            <CategoryDonut
              slices={categorySlices.slices}
              total={categorySlices.total}
            />
          )}
        </Card>
      </div>

      <div className="grid grid--dash">
        <Card>
          <CardHead
            title="Recent activity"
            hint="The five newest transactions in this period."
            action={
              totalCount > 0 ? (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => navigate("transactions")}
                >
                  View all
                </button>
              ) : undefined
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              icon={<Receipt size={20} />}
              title="Nothing recorded yet"
              text="Add an entry or import a statement to see activity here."
            />
          ) : (
            <div>
              {recent.map((tx) => (
                <div className="list-row" key={tx.id}>
                  <div className="list-row__main">
                    <p className="list-row__title">{tx.merchant}</p>
                    <p className="list-row__meta">
                      {formatDate(tx.date)} · {tx.category} · {tx.account}
                    </p>
                  </div>
                  <span
                    className={`amount amount--${tx.type === "income" ? "income" : "expense"}`}
                  >
                    {signedMoney(tx.amount, tx.type)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="stack">
          <Card>
            <CardHead title="Pocket Ledger insight" />
            {totalCount === 0 ? (
              <EmptyState
                icon={<Lightbulb size={20} />}
                title="Insights appear with your data"
                text="Pocket Ledger only reports facts calculated from what you have saved."
              />
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                <p className="stat-line">
                  <span className="stat-line__label">Transactions saved</span>
                  <span className="stat-line__value">{totalCount}</span>
                </p>
                <p className="stat-line">
                  <span className="stat-line__label">Waiting in Needs review</span>
                  <span className="stat-line__value">{needsReview}</span>
                </p>
                {needsReview > 0 ? (
                  <button
                    type="button"
                    className="btn btn--sm"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => navigate("transactions")}
                  >
                    Categorize them
                  </button>
                ) : null}
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Coming up" />
            {upcoming.length === 0 ? (
              <EmptyState
                icon={<CalendarClock size={20} />}
                title="No confirmed payments due"
                text="Confirm a recurring payment or subscription and its next date appears here."
                action={
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => navigate("recurring")}
                  >
                    Go to Recurring
                  </button>
                }
              />
            ) : (
              <div>
                {upcoming.map((item) => (
                  <div className="list-row" key={`${item.kind}-${item.name}-${item.date}`}>
                    <div className="list-row__main">
                      <p className="list-row__title">{item.name}</p>
                      <p className="list-row__meta">
                        {item.kind} · {formatDate(item.date)} ·{" "}
                        {relativeDueLabel(item.date)}
                      </p>
                    </div>
                    <span className="amount">{money(item.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function sum(rows: Transaction[]): number {
  return rows.reduce((total, tx) => total + tx.amount, 0);
}

/** Up to seven monthly points, built only from months that actually have data. */
function buildCashFlow(transactions: Transaction[]): CashFlowPoint[] {
  if (transactions.length === 0) return [];

  const byMonth = new Map<string, { income: number; expense: number }>();
  for (const tx of transactions) {
    const key = tx.date.slice(0, 7);
    const bucket = byMonth.get(key) ?? { income: 0, expense: 0 };
    if (tx.type === "income") bucket.income += tx.amount;
    else bucket.expense += tx.amount;
    byMonth.set(key, bucket);
  }

  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    .map(([key, value]) => {
      const [year, month] = key.split("-").map(Number);
      const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
        LOCALE,
        { month: "short", timeZone: "UTC" },
      );
      return { label, income: value.income, expense: value.expense };
    });
}

function buildCategorySlices(transactions: Transaction[]) {
  const byCategory = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type !== "expense") continue;
    byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + tx.amount);
  }
  const slices = [...byCategory.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const total = slices.reduce((acc, slice) => acc + slice.value, 0);
  return { slices, total };
}

/**
 * A comparison is shown only when real data exists on both sides. There are no
 * invented month-over-month arrows.
 */
function TrendStrip({
  label,
  current,
  previous,
  positiveIsGood,
}: {
  label: string;
  current: number;
  previous: number | null;
  positiveIsGood: boolean;
}) {
  if (previous === null || previous === 0) {
    return (
      <p className="calc-strip">
        <span className="calc-strip__label">No trend yet</span>
        <span>A comparison appears once the previous period has data.</span>
      </p>
    );
  }

  const change = ((current - previous) / previous) * 100;
  const up = change >= 0;
  const good = positiveIsGood ? up : !up;

  return (
    <p className="calc-strip">
      <span className="calc-strip__label">{label}</span>
      <span className={`trend ${good ? "trend--up" : "trend--down"}`}>
        {up ? (
          <ArrowUpRight size={14} aria-hidden="true" />
        ) : (
          <ArrowDownRight size={14} aria-hidden="true" />
        )}
        {percent(Math.abs(change), 1)}
      </span>
      <span>from {money(previous)}</span>
    </p>
  );
}
