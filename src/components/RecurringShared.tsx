import { CalendarClock, Check, EyeOff, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import type { Cadence } from "../../shared/types";
import { formatDate, money, percent, relativeDueLabel, todayISO } from "../lib/format";
import { CADENCE_LABEL, type DetectedPattern } from "../lib/recurring";
import { Field, Modal, Notice, Spinner } from "./ui";

export const CADENCE_OPTIONS: Array<{ value: Cadence; label: string }> = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
];

/** One detection suggestion. Nothing is confirmed until the user chooses Keep. */
export function SuggestionCard({
  pattern,
  onKeep,
  onIgnore,
  busy,
}: {
  pattern: DetectedPattern;
  onKeep: () => void;
  onIgnore: () => void;
  busy: boolean;
}) {
  return (
    <article className="suggestion">
      <div className="row row--between">
        <div>
          <p className="list-row__title">{pattern.merchant}</p>
          <p className="list-row__meta">
            {pattern.category} · {CADENCE_LABEL[pattern.cadence]}
          </p>
        </div>
        <span
          className={`pill ${pattern.confidence === "high" ? "pill--green" : "pill--blue"}`}
        >
          <Sparkles size={12} aria-hidden="true" />
          {pattern.confidence === "high" ? "High confidence" : "Likely"}
        </span>
      </div>

      <div className="suggestion__grid">
        <div>
          <p className="mini-label">Occurrences</p>
          <p className="mini-value">{pattern.occurrences}</p>
        </div>
        <div>
          <p className="mini-label">Average charge</p>
          <p className="mini-value">{money(pattern.averageAmount)}</p>
        </div>
        <div>
          <p className="mini-label">Per month</p>
          <p className="mini-value">{money(pattern.monthlyEquivalent)}</p>
        </div>
        <div>
          <p className="mini-label">Amount variation</p>
          <p className="mini-value">{percent(pattern.variation * 100, 1)}</p>
        </div>
        <div>
          <p className="mini-label">Next expected</p>
          <p className="mini-value">{formatDate(pattern.nextDate)}</p>
        </div>
      </div>

      <div className="row">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={onKeep}
          disabled={busy}
        >
          <Check size={15} aria-hidden="true" />
          Keep
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={onIgnore}
          disabled={busy}
        >
          <EyeOff size={15} aria-hidden="true" />
          Ignore
        </button>
        <span className="cell-meta">
          Last charged {formatDate(pattern.lastDate)}
        </span>
      </div>
    </article>
  );
}

export interface EntryDraft {
  id?: string;
  name: string;
  group: string;
  amount: string;
  cadence: Cadence;
  nextDate: string;
  account: string;
  active: boolean;
}

export function emptyDraft(defaultGroup: string): EntryDraft {
  return {
    name: "",
    group: defaultGroup,
    amount: "",
    cadence: "monthly",
    nextDate: todayISO(),
    account: "",
    active: true,
  };
}

/** Shared editor for a recurring payment or a subscription. */
export function EntryFormModal({
  title,
  nameLabel,
  groupLabel,
  dateLabel,
  groupOptions,
  accounts,
  draft,
  onClose,
  onSave,
  onDelete,
}: {
  title: string;
  nameLabel: string;
  groupLabel: string;
  dateLabel: string;
  groupOptions: string[];
  accounts: string[];
  draft: EntryDraft;
  onClose: () => void;
  onSave: (value: EntryDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const ids = {
    name: useId(),
    group: useId(),
    amount: useId(),
    cadence: useId(),
    date: useId(),
    account: useId(),
  };
  const [value, setValue] = useState<EntryDraft>(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof EntryDraft>(key: K, next: EntryDraft[K]) {
    setValue((current) => ({ ...current, [key]: next }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!value.name.trim()) next.name = "Enter a name.";
    const amount = Number(value.amount);
    if (!value.amount.trim()) next.amount = "Enter an amount.";
    else if (!Number.isFinite(amount) || amount <= 0)
      next.amount = "Amount must be greater than 0.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.nextDate))
      next.nextDate = "Choose a valid date.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    setFormError(null);
    try {
      await onSave(value);
      onClose();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "That entry could not be saved.",
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <button
              type="button"
              className="btn btn--danger"
              disabled={saving}
              onClick={() => void onDelete().then(onClose)}
              style={{ marginRight: "auto" }}
            >
              Delete
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="entry-form"
            className="btn btn--primary"
            disabled={saving}
          >
            {saving ? <Spinner label="Saving" /> : "Save"}
          </button>
        </>
      }
    >
      <form id="entry-form" className="stack" onSubmit={submit} noValidate>
        {formError ? <Notice kind="error">{formError}</Notice> : null}

        <Field label={nameLabel} error={errors.name} htmlFor={ids.name}>
          <input
            id={ids.name}
            className="input"
            value={value.name}
            maxLength={120}
            onChange={(event) => update("name", event.target.value)}
          />
        </Field>

        <div className="grid grid--2">
          <Field label={groupLabel} htmlFor={ids.group}>
            <select
              id={ids.group}
              className="select"
              value={value.group}
              onChange={(event) => update("group", event.target.value)}
            >
              {groupOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Amount" error={errors.amount} htmlFor={ids.amount}>
            <input
              id={ids.amount}
              className="input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={value.amount}
              onChange={(event) => update("amount", event.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid--2">
          <Field label="Cadence" htmlFor={ids.cadence}>
            <select
              id={ids.cadence}
              className="select"
              value={value.cadence}
              onChange={(event) => update("cadence", event.target.value as Cadence)}
            >
              {CADENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={dateLabel}
            error={errors.nextDate}
            hint={
              /^\d{4}-\d{2}-\d{2}$/.test(value.nextDate)
                ? relativeDueLabel(value.nextDate)
                : undefined
            }
            htmlFor={ids.date}
          >
            <input
              id={ids.date}
              className="input"
              type="date"
              value={value.nextDate}
              onChange={(event) => update("nextDate", event.target.value)}
            />
          </Field>
        </div>

        <Field label="Account (optional)" htmlFor={ids.account}>
          <select
            id={ids.account}
            className="select"
            value={value.account}
            onChange={(event) => update("account", event.target.value)}
          >
            <option value="">No account</option>
            {accounts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={value.active}
            onChange={(event) => update("active", event.target.checked)}
          />
          Active
        </label>
      </form>
    </Modal>
  );
}

export function NextDueLine({ date }: { date: string }) {
  if (!date) return <span className="cell-meta">No date set</span>;
  return (
    <span className="cell-meta">
      <CalendarClock size={12} aria-hidden="true" /> {formatDate(date)} ·{" "}
      {relativeDueLabel(date)}
    </span>
  );
}
