import { CreditCard, Plus, Settings2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { SubscriptionEntry } from "../../shared/types";
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

export function Subscriptions() {
  const state = useAppState();
  const { savePreferences, notify } = usePocketLedger();
  const { settings, transactions } = state;

  const [editing, setEditing] = useState<EntryDraft | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const detected = detectPatterns(transactions).filter(
      (pattern) => pattern.kind === "subscription",
    );
    return visibleSuggestions(detected, settings.dismissedPatterns, [
      ...settings.subscriptions.map((entry) => entry.name),
      ...settings.recurring.map((entry) => entry.name),
    ]);
  }, [transactions, settings]);

  const confirmed = settings.subscriptions;
  const activeConfirmed = confirmed.filter((entry) => entry.active);

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

  const nextRenewal = [...activeConfirmed]
    .filter((entry) => entry.nextRenewal)
    .sort((a, b) => a.nextRenewal.localeCompare(b.nextRenewal))[0];

  const groupOptions = useMemo(() => {
    const names = new Set(settings.categories);
    names.add("Subscriptions");
    return [...names];
  }, [settings.categories]);

  async function keep(patternKey: string) {
    const pattern = suggestions.find((item) => item.key === patternKey);
    if (!pattern) return;
    setBusyKey(patternKey);
    try {
      const entry: SubscriptionEntry = {
        id: crypto.randomUUID(),
        name: pattern.merchant,
        group: pattern.category,
        amount: Number(pattern.averageAmount.toFixed(2)),
        cadence: pattern.cadence,
        nextRenewal: pattern.nextDate,
        account: pattern.account,
        active: true,
        createdAt: new Date().toISOString(),
      };
      await savePreferences({ subscriptions: [...settings.subscriptions, entry] });
      notify(`${pattern.merchant} was added to your subscriptions.`);
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
    const entry: SubscriptionEntry = {
      id: draft.id ?? crypto.randomUUID(),
      name: draft.name.trim(),
      group: draft.group,
      amount: Number(draft.amount),
      cadence: draft.cadence,
      nextRenewal: draft.nextDate,
      account: draft.account || undefined,
      active: draft.active,
      createdAt: new Date().toISOString(),
    };
    const next = draft.id
      ? settings.subscriptions.map((item) => (item.id === draft.id ? entry : item))
      : [...settings.subscriptions, entry];
    await savePreferences({ subscriptions: next });
    notify(draft.id ? "Subscription updated." : "Subscription added.");
  }

  async function deleteEntry(id: string) {
    await savePreferences({
      subscriptions: settings.subscriptions.filter((item) => item.id !== id),
    });
    notify("Subscription removed.");
  }

  return (
    <div className="stack">
      <div className="grid grid--3">
        <article className="summary-card">
          <header className="summary-card__head">
            <span className="summary-card__icon" aria-hidden="true">
              <CreditCard size={16} />
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
              <CreditCard size={16} />
            </span>
            Estimated annual
          </header>
          <p className="summary-card__value">{money(annualTotal)}</p>
          <p className="calc-strip">
            <span className="calc-strip__label">Calculation</span>
            <span>monthly subscriptions × 12</span>
          </p>
        </article>

        <article className="summary-card">
          <header className="summary-card__head">
            <span
              className="summary-card__icon summary-card__icon--blue"
              aria-hidden="true"
            >
              <CreditCard size={16} />
            </span>
            Next renewal
          </header>
          {nextRenewal ? (
            <>
              <p className="summary-card__value">{money(nextRenewal.amount)}</p>
              <p className="calc-strip">
                <span className="calc-strip__label">{nextRenewal.name}</span>
                <NextDueLine date={nextRenewal.nextRenewal} />
              </p>
            </>
          ) : (
            <>
              <p className="summary-card__value summary-card__value--muted">
                None yet
              </p>
              <p className="calc-strip">
                <span className="calc-strip__label">Next renewal</span>
                <span>appears once a subscription is confirmed.</span>
              </p>
            </>
          )}
        </article>
      </div>

      <Card>
        <CardHead
          title="Detected subscriptions"
          hint="Stable repeat charges from services you appear to subscribe to."
        />
        {suggestions.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={20} />}
            title="No subscriptions detected yet"
            text="Pocket Ledger looks for steady repeat charges with a recognizable service name or a subscription category."
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
          title="Confirmed subscriptions"
          action={
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => setEditing(emptyDraft("Subscriptions"))}
            >
              <Plus size={15} aria-hidden="true" />
              Add subscription
            </button>
          }
        />
        {confirmed.length === 0 ? (
          <EmptyState
            icon={<CreditCard size={20} />}
            title="No confirmed subscriptions"
            text="Keep a detected subscription above, or add one manually."
          />
        ) : (
          <div>
            {confirmed.map((entry) => (
              <div className="list-row" key={entry.id}>
                <div className="list-row__main">
                  <p className="list-row__title">
                    {entry.name}{" "}
                    {entry.active ? null : <span className="pill">Paused</span>}
                  </p>
                  <p className="list-row__meta">
                    {entry.group} · {CADENCE_LABEL[entry.cadence]}
                    {entry.account ? ` · ${entry.account}` : ""}
                  </p>
                  <NextDueLine date={entry.nextRenewal} />
                </div>
                <span className="amount">{money(entry.amount)}</span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() =>
                    setEditing({
                      id: entry.id,
                      name: entry.name,
                      group: entry.group,
                      amount: String(entry.amount),
                      cadence: entry.cadence,
                      nextDate: entry.nextRenewal,
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
          title={editing.id ? "Edit subscription" : "Add subscription"}
          nameLabel="Service name"
          groupLabel="Group"
          dateLabel="Next renewal"
          groupOptions={groupOptions}
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
