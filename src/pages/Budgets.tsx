import { Plus, Sliders, Trash2, Wallet } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { Budget } from "../../shared/types";
import {
  Card,
  CardHead,
  EmptyState,
  Field,
  Modal,
  Notice,
  ProgressBar,
  Spinner,
  useConfirmClose,
} from "../components/ui";
import { LOCALE, money, percent, todayISO } from "../lib/format";
import { useAppState, usePocketLedger } from "../store";

interface BudgetStat {
  budget: Budget;
  spent: number;
  remaining: number;
  pct: number;
  over: boolean;
}

export function Budgets() {
  const state = useAppState();
  const { savePreferences, notify } = usePocketLedger();
  const { settings, transactions } = state;

  const [editing, setEditing] = useState<Budget | "new" | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  // Local calendar month, not UTC — a UTC-derived "today" runs a day behind
  // IST for part of every day, which on the 1st of the month would attribute
  // that day's spending to the wrong month entirely.
  const monthKey = todayISO().slice(0, 7);

  const stats = useMemo<BudgetStat[]>(() => {
    const spendByCategory = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.type !== "expense") continue;
      if (!tx.date.startsWith(monthKey)) continue;
      spendByCategory.set(
        tx.category,
        (spendByCategory.get(tx.category) ?? 0) + tx.amount,
      );
    }
    return settings.budgets.map((budget) => {
      const spent = spendByCategory.get(budget.category) ?? 0;
      const pct = budget.limit > 0 ? (spent / budget.limit) * 100 : 0;
      return {
        budget,
        spent,
        remaining: budget.limit - spent,
        pct,
        over: spent > budget.limit,
      };
    });
  }, [settings.budgets, transactions, monthKey]);

  const activeStats = stats.filter((stat) => stat.budget.active);
  const totalLimit = activeStats.reduce((sum, s) => sum + s.budget.limit, 0);
  const totalSpent = activeStats.reduce((sum, s) => sum + s.spent, 0);
  const overCount = activeStats.filter((s) => s.over).length;
  const healthPct =
    totalLimit > 0 ? Math.min(100, (totalSpent / totalLimit) * 100) : 0;

  async function saveBudget(budget: Budget) {
    const exists = settings.budgets.some((b) => b.id === budget.id);
    const next = exists
      ? settings.budgets.map((b) => (b.id === budget.id ? budget : b))
      : [...settings.budgets, budget];
    await savePreferences({ budgets: next });
    notify(exists ? "Budget updated." : "Budget created.");
  }

  async function removeBudget(id: string) {
    await savePreferences({
      budgets: settings.budgets.filter((b) => b.id !== id),
    });
    notify("Budget deleted.");
  }

  const monthLabel = new Date().toLocaleDateString(LOCALE, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="stack">
      <div className="row row--between">
        <div>
          <h2 className="section-title">Budgets</h2>
          <p className="page-intro">
            Monthly limits measured against real spending in {monthLabel}.
          </p>
        </div>
        <div className="row">
          {settings.budgets.length > 0 ? (
            <button
              type="button"
              className="btn"
              onClick={() => setAdjusting(true)}
            >
              <Sliders size={16} aria-hidden="true" />
              Adjust budgets
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setEditing("new")}
          >
            <Plus size={16} aria-hidden="true" />
            Create budget
          </button>
        </div>
      </div>

      {settings.budgets.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet size={20} />}
            title="No budgets yet"
            text="Create a budget to compare a monthly limit against what you actually spend in that category."
            action={
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setEditing("new")}
              >
                Create budget
              </button>
            }
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHead
              title="Budget health"
              hint={`Calculated from ${activeStats.length} active budget${
                activeStats.length === 1 ? "" : "s"
              }.`}
            />
            <div className="row" style={{ gap: 22, alignItems: "center" }}>
              <HealthRing pct={healthPct} over={overCount > 0} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="stat-line">
                  <span className="stat-line__label">Spent this month</span>
                  <span className="stat-line__value">{money(totalSpent)}</span>
                </div>
                <div className="stat-line">
                  <span className="stat-line__label">Total budgeted</span>
                  <span className="stat-line__value">{money(totalLimit)}</span>
                </div>
                <div className="stat-line">
                  <span className="stat-line__label">Remaining</span>
                  <span className="stat-line__value">
                    {money(Math.max(0, totalLimit - totalSpent))}
                  </span>
                </div>
                <div className="stat-line">
                  <span className="stat-line__label">Over budget</span>
                  <span className="stat-line__value">
                    {overCount} categor{overCount === 1 ? "y" : "ies"}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid--2">
            {stats.map((stat) => (
              <Card key={stat.budget.id}>
                <div className="row row--between" style={{ marginBottom: 10 }}>
                  <div>
                    <p className="card__title">{stat.budget.category}</p>
                    <p className="card__hint">
                      {stat.budget.active ? "Active" : "Paused"} · limit{" "}
                      {money(stat.budget.limit)}
                    </p>
                  </div>
                  <span
                    className={`pill ${
                      stat.over ? "pill--red" : stat.pct > 80 ? "pill--orange" : "pill--green"
                    }`}
                  >
                    {stat.over ? "Over budget" : percent(stat.pct)}
                  </span>
                </div>

                <ProgressBar
                  value={stat.spent}
                  max={stat.budget.limit || 1}
                  tone={stat.over ? "red" : stat.pct > 80 ? "orange" : "green"}
                  label={`${stat.budget.category} budget usage`}
                />

                <div className="stat-line" style={{ marginTop: 10 }}>
                  <span className="stat-line__label">Spent</span>
                  <span className="stat-line__value">{money(stat.spent)}</span>
                </div>
                <div className="stat-line">
                  <span className="stat-line__label">
                    {stat.over ? "Over by" : "Remaining"}
                  </span>
                  <span className="stat-line__value">
                    {money(Math.abs(stat.remaining))}
                  </span>
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setEditing(stat.budget)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void removeBudget(stat.budget.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {editing ? (
        <BudgetModal
          budget={editing === "new" ? null : editing}
          categories={settings.categories}
          usedCategories={settings.budgets.map((b) => b.category)}
          onClose={() => setEditing(null)}
          onSave={saveBudget}
        />
      ) : null}

      {adjusting ? (
        <AdjustBudgetsModal
          budgets={settings.budgets}
          onClose={() => setAdjusting(false)}
          onSave={async (next) => {
            await savePreferences({ budgets: next });
            notify("Budgets updated.");
          }}
        />
      ) : null}
    </div>
  );
}

function HealthRing({ pct, over }: { pct: number; over: boolean }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.min(100, pct) / 100) * circumference;
  const color = over ? "#C2413C" : pct > 80 ? "#D97316" : "#17915D";

  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      role="img"
      aria-label={`Budget usage ${Math.round(pct)} percent`}
      style={{ flex: "0 0 auto" }}
    >
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        stroke="#EDEEF3"
        strokeWidth="12"
      />
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
        transform="rotate(-90 60 60)"
      />
      <text
        x="60"
        y="57"
        textAnchor="middle"
        fontSize="20"
        fontWeight="700"
        fill="#1C1F2B"
      >
        {Math.round(pct)}%
      </text>
      <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#7A8095">
        of budget
      </text>
    </svg>
  );
}

function BudgetModal({
  budget,
  categories,
  usedCategories,
  onClose,
  onSave,
}: {
  budget: Budget | null;
  categories: string[];
  usedCategories: string[];
  onClose: () => void;
  onSave: (budget: Budget) => Promise<void>;
}) {
  const ids = { category: useId(), limit: useId() };
  const available = categories.filter(
    (name) => name === budget?.category || !usedCategories.includes(name),
  );

  const [category, setCategory] = useState(
    budget?.category ?? available[0] ?? categories[0] ?? "",
  );
  const [limit, setLimit] = useState(budget ? String(budget.limit) : "");
  const [active, setActive] = useState(budget?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isDirty =
    category !== (budget?.category ?? available[0] ?? categories[0] ?? "") ||
    limit !== (budget ? String(budget.limit) : "") ||
    active !== (budget?.active ?? true);
  const { requestClose, discardPrompt } = useConfirmClose(isDirty, onClose);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(limit);
    if (!category) {
      setError("Choose a category.");
      return;
    }
    if (!limit.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError("Enter a monthly limit greater than 0.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: budget?.id ?? crypto.randomUUID(),
        category,
        limit: amount,
        active,
        createdAt: budget?.createdAt ?? new Date().toISOString(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That budget was not saved.");
      setSaving(false);
    }
  }

  return (
    <>
    <Modal
      title={budget ? "Edit budget" : "Create budget"}
      onClose={requestClose}
      footer={
        <>
          <button type="button" className="btn" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="budget-form"
            className="btn btn--primary"
            disabled={saving}
          >
            {saving ? <Spinner label="Saving" /> : "Save budget"}
          </button>
        </>
      }
    >
      <form id="budget-form" className="stack" onSubmit={submit} noValidate>
        {error ? <Notice kind="error">{error}</Notice> : null}

        <Field label="Category" htmlFor={ids.category}>
          <select
            id={ids.category}
            className="select"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {available.length === 0 ? (
              <option value="">Every category already has a budget</option>
            ) : (
              available.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))
            )}
          </select>
        </Field>

        <Field label="Monthly limit" htmlFor={ids.limit}>
          <input
            id={ids.limit}
            className="input"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
        </Field>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          Active
        </label>
      </form>
    </Modal>
    {discardPrompt}
    </>
  );
}

function AdjustBudgetsModal({
  budgets,
  onClose,
  onSave,
}: {
  budgets: Budget[];
  onClose: () => void;
  onSave: (next: Budget[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Budget[]>(budgets);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(budgets);
  const { requestClose, discardPrompt } = useConfirmClose(isDirty, onClose);

  async function save() {
    if (draft.some((b) => !Number.isFinite(b.limit) || b.limit <= 0)) {
      setError("Every limit must be greater than 0.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Those changes were not saved.");
      setSaving(false);
    }
  }

  return (
    <>
    <Modal
      title="Adjust budgets"
      subtitle="Change limits, pause a budget, or remove one."
      onClose={requestClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? <Spinner label="Saving" /> : "Save changes"}
          </button>
        </>
      }
    >
      {error ? <Notice kind="error">{error}</Notice> : null}
      {draft.length === 0 ? (
        <p className="page-intro">No budgets remain.</p>
      ) : (
        draft.map((budget) => (
          <div className="row" key={budget.id} style={{ gap: 10, flexWrap: "nowrap" }}>
            <span style={{ flex: 1, minWidth: 0 }}>{budget.category}</span>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              style={{ maxWidth: 130 }}
              aria-label={`Monthly limit for ${budget.category}`}
              value={budget.limit}
              onChange={(event) =>
                setDraft((current) =>
                  current.map((b) =>
                    b.id === budget.id
                      ? { ...b, limit: Number(event.target.value) }
                      : b,
                  ),
                )
              }
            />
            <label className="checkbox" style={{ minHeight: 0 }}>
              <input
                type="checkbox"
                checked={budget.active}
                onChange={(event) =>
                  setDraft((current) =>
                    current.map((b) =>
                      b.id === budget.id
                        ? { ...b, active: event.target.checked }
                        : b,
                    ),
                  )
                }
              />
              <span className="sr-only">{budget.category} active</span>
            </label>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                setDraft((current) => current.filter((b) => b.id !== budget.id))
              }
              aria-label={`Remove the ${budget.category} budget`}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        ))
      )}
    </Modal>
    {discardPrompt}
    </>
  );
}
