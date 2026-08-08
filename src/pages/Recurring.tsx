import { Plus, RadioTower, RefreshCw, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { RecurringEntry } from "../../shared/types";
import {
  EntryFormModal,
  NextDueLine,
  SuggestionCard,
  emptyDraft,
  type EntryDraft,
} from "../components/RecurringShared";
import { Card, CardHead, EmptyState } from "../components/ui";
import { money } from "../lib/format";
import {
  CADENCE_LABEL,
  annualEquivalent,
  detectPatterns,
  monthlyEquivalent,
  visibleSuggestions,
} from "../lib/recurring";
import { useAppState, usePocketLedger } from "../store";

export function Recurring() {
  const state = useAppState();
  const { savePreferences, notify } = usePocketLedger();
  const { settings, transactions } = state;

  const [editing, setEditing] = useState<EntryDraft | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const detected = detectPatterns(transactions).filter(
      (pattern) => pattern.kind === "recurring",
    );
    return visibleSuggestions(detected, settings.dismissedPatterns, [
      ...settings.recurring.map((entry) => entry.name),
      ...settings.subscriptions.map((entry) => entry.name),
    ]);
  }, [transactions, settings]);

  const confirmed = settings.recurring;
  const activeConfirmed = confirmed.filter((entry) => entry.active);

  // Suggestions and confirmed entries never double-count: a kept suggestion
  // stops being suggested.
  const monthlyTotal =
    activeConfirmed.reduce(
      (sum, entry) => sum + monthlyEquivalent(entry.amount, entry.cadence),
      0,
    ) + suggestions.reduce((sum, pattern) => sum + pattern.monthlyEquivalent, 0);

  const annualTotal =
    activeConfirmed.reduce(
      (sum, entry) => sum + annualEquivalent(entry.amount, entry.cadence),
      0,
    ) +
    suggestions.reduce((sum, pattern) => sum + pattern.monthlyEquivalent * 12, 0);

  const nextPayment = [...activeConfirmed]
    .filter((entry) => entry.nextDate)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0];

  async function keep(patternKey: string) {
    const pattern = suggestions.find((item) => item.key === patternKey);
    if (!pattern) return;
    setBusyKey(patternKey);
    try {
      const entry: RecurringEntry = {
        id: crypto.randomUUID(),
        name: pattern.merchant,
        category: pattern.category,
        amount: Number(pattern.averageAmount.toFixed(2)),
        cadence: pattern.cadence,
        nextDate: pattern.nextDate,
        account: pattern.account,
        active: true,
        createdAt: new Date().toISOString(),
      };
      await savePreferences({ recurring: [...settings.recurring, entry] });
      notify(`${pattern.merchant} was added to your recurring payments.`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "That suggestion was not saved.",
        "error",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function ignore(patternKey: string) {
    setBusyKey(patternKey);
    try {
      await savePreferences({
        dismissedPatterns: [...settings.dismissedPatterns, patternKey],
      });
      notify("Suggestion hidden. You can restore it in Settings.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "That change was not saved.",
        "error",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function saveEntry(draft: EntryDraft) {
    const entry: RecurringEntry = {
      id: draft.id ?? crypto.randomUUID(),
      name: draft.name.trim(),
      category: draft.group,
      amount: Number(draft.amount),
      cadence: draft.cadence,
      nextDate: draft.nextDate,
      account: draft.account || undefined,
      active: draft.active,
      createdAt: new Date().toISOString(),
    };
    const next = draft.id
      ? settings.recurring.map((item) => (item.id === draft.id ? entry : item))
      : [...settings.recurring, entry];
    await savePreferences({ recurring: next });
    notify(draft.id ? "Recurring payment updated." : "Recurring payment added.");
  }

  async function deleteEntry(id: string) {
    await savePreferences({
      recurring: settings.recurring.filter((item) => item.id !== id),
    });
    notify("Recurring payment removed.");
  }

  return (
    <div className="stack">
      <div className="banner">
        <RadioTower size={18} aria-hidden="true" />
        <span>
          <strong>Detection is active.</strong> Pocket Ledger looks for repeating
          charges in your saved expenses and suggests them here. Nothing is
          confirmed until you choose Keep.
        </span>
      </div>

      <div className="grid grid--3">
        <article className="summary-card">
          <header className="summary-card__head">
            <span className="summary-card__icon" aria-hidden="true">
              <RefreshCw size={16} />
            </span>
            Estimated monthly
          </header>
          <p className="summary-card__value">{money(monthlyTotal)}</p>
          <p className="calc-strip">
            <span className="calc-strip__label">Includes</span>
            <span>
              {activeConfirmed.length} confirmed · {suggestions.length} suggested
            </span>
          </p>
        </article>

        <article className="summary-card">
          <header className="summary-card__head">
            <span
              className="summary-card__icon summary-card__icon--orange"
              aria-hidden="true"
            >
              <RefreshCw size={16} />
            </span>
            Estimated annual
          </header>
          <p className="summary-card__value">{money(annualTotal)}</p>
          <p className="calc-strip">
            <span className="calc-strip__label">Calculation</span>
            <span>monthly commitment × 12</span>
          </p>
        </article>

        <article className="summary-card">
          <header className="summary-card__head">
            <span
              className="summary-card__icon summary-card__icon--blue"
              aria-hidden="true"
            >
              <RefreshCw size={16} />
            </span>
            Next expected payment
          </header>
          {nextPayment ? (
            <>
              <p className="summary-card__value">{money(nextPayment.amount)}</p>
              <p className="calc-strip">
                <span className="calc-strip__label">{nextPayment.name}</span>
                <NextDueLine date={nextPayment.nextDate} />
              </p>
            </>
          ) : (
            <>
              <p className="summary-card__value summary-card__value--muted">
                None yet
              </p>
              <p className="calc-strip">
                <span className="calc-strip__label">Next payment</span>
                <span>appears once a recurring payment is confirmed.</span>
              </p>
            </>
          )}
        </article>
      </div>

      <Card>
        <CardHead
          title="Suggestions"
          hint="Detected from real repeating expenses — never from a merchant name alone."
        />
        {suggestions.length === 0 ? (
          <EmptyState
            icon={<RefreshCw size={20} />}
            title="No recurring patterns detected yet"
            text="Pocket Ledger needs at least two dated charges from the same merchant with a steady interval and a stable amount."
          />
        ) : (
          <div className="stack">
            {suggestions.map((pattern) => (
              <SuggestionCard
                key={pattern.key}
                pattern={pattern}
                busy={busyKey === pattern.key}
                onKeep={() => void keep(pattern.key)}
                onIgnore={() => void ignore(pattern.key)}
              />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHead
          title="Confirmed recurring payments"
          action={
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => setEditing(emptyDraft(settings.categories[0] ?? "Other"))}
            >
              <Plus size={15} aria-hidden="true" />
              Add recurring payment
            </button>
          }
        />
        {confirmed.length === 0 ? (
          <EmptyState
            icon={<RefreshCw size={20} />}
            title="No confirmed recurring payments"
            text="Keep a suggestion above, or add one manually."
          />
        ) : (
          <div>
            {confirmed.map((entry) => (
              <div className="list-row" key={entry.id}>
                <div className="list-row__main">
                  <p className="list-row__title">
                    {entry.name}{" "}
                    {entry.active ? null : (
                      <span className="pill">Paused</span>
                    )}
                  </p>
                  <p className="list-row__meta">
                    {entry.category} · {CADENCE_LABEL[entry.cadence]}
                    {entry.account ? ` · ${entry.account}` : ""}
                  </p>
                  <NextDueLine date={entry.nextDate} />
                </div>
                <span className="amount">{money(entry.amount)}</span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() =>
                    setEditing({
                      id: entry.id,
                      name: entry.name,
                      group: entry.category,
                      amount: String(entry.amount),
                      cadence: entry.cadence,
                      nextDate: entry.nextDate,
                      account: entry.account ?? "",
                      active: entry.active,
                    })
                  }
                >
                  <Settings2 size={14} aria-hidden="true" />
                  Manage
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editing ? (
        <EntryFormModal
          title={editing.id ? "Edit recurring payment" : "Add recurring payment"}
          nameLabel="Name"
          groupLabel="Category"
          dateLabel="Next date"
          groupOptions={settings.categories.length ? settings.categories : ["Other"]}
          accounts={settings.accounts}
          draft={editing}
          onClose={() => setEditing(null)}
          onSave={saveEntry}
          onDelete={
            editing.id ? () => deleteEntry(editing.id as string) : undefined
          }
        />
      ) : null}
    </div>
  );
}
