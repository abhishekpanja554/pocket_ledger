import {
  ExternalLink,
  FolderSync,
  Landmark,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Sun,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import { useUi } from "../App";
import {
  Card,
  CardHead,
  ConfirmDialog,
  Field,
  Notice,
  Spinner,
} from "../components/ui";
import { formatTimestamp, money } from "../lib/format";
import { type Theme, useTheme } from "../lib/theme";
import { useAppState, usePocketLedger } from "../store";

export function Settings() {
  const state = useAppState();
  const { savePreferences, notify, logout } = usePocketLedger();
  const { openModal } = useUi();
  const { settings } = state;

  const ids = { assets: useId(), liabilities: useId() };

  const [assets, setAssets] = useState(
    settings.netWorthConfigured ? String(settings.assets) : "",
  );
  const [liabilities, setLiabilities] = useState(
    settings.netWorthConfigured ? String(settings.liabilities) : "",
  );
  const [netWorthError, setNetWorthError] = useState<string | null>(null);
  const [savingNetWorth, setSavingNetWorth] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [theme, setThemeChoice] = useTheme();

  const previewAssets = Number(assets) || 0;
  const previewLiabilities = Number(liabilities) || 0;

  async function saveNetWorth() {
    const a = Number(assets);
    const l = Number(liabilities);
    if (!assets.trim() || !liabilities.trim()) {
      setNetWorthError("Enter both totals. Use 0 if one does not apply.");
      return;
    }
    if (!Number.isFinite(a) || a < 0 || !Number.isFinite(l) || l < 0) {
      setNetWorthError("Totals must be 0 or more.");
      return;
    }
    setSavingNetWorth(true);
    setNetWorthError(null);
    try {
      await savePreferences({
        assets: a,
        liabilities: l,
        netWorthConfigured: true,
      });
      notify("Net worth saved.");
    } catch (error) {
      setNetWorthError(
        error instanceof Error ? error.message : "Those totals were not saved.",
      );
    } finally {
      setSavingNetWorth(false);
    }
  }

  async function clearNetWorth() {
    setSavingNetWorth(true);
    try {
      await savePreferences({
        assets: 0,
        liabilities: 0,
        netWorthConfigured: false,
      });
      setAssets("");
      setLiabilities("");
      notify("Net worth reset to Not set.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "That change was not saved.",
        "error",
      );
    } finally {
      setSavingNetWorth(false);
    }
  }

  async function restoreIgnored() {
    setRestoring(true);
    try {
      await savePreferences({ dismissedPatterns: [] });
      notify("Ignored suggestions restored.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "That change was not saved.",
        "error",
      );
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="stack">
      {/* ------------------------------------------------------ net worth */}
      <Card>
        <CardHead
          title="Net worth setup"
          hint="Net worth is your assets minus your liabilities. It is not calculated from monthly income minus expenses."
        />

        <div className="grid grid--2">
          <Field label="Total assets" htmlFor={ids.assets}>
            <input
              id={ids.assets}
              className="input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={assets}
              onChange={(event) => setAssets(event.target.value)}
            />
          </Field>
          <Field label="Total liabilities" htmlFor={ids.liabilities}>
            <input
              id={ids.liabilities}
              className="input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={liabilities}
              onChange={(event) => setLiabilities(event.target.value)}
            />
          </Field>
        </div>

        <div className="stat-line" style={{ marginTop: 6 }}>
          <span className="stat-line__label">
            <Landmark size={14} aria-hidden="true" /> Live preview
          </span>
          <span className="stat-line__value">
            {money(previewAssets - previewLiabilities)}
          </span>
        </div>

        {netWorthError ? <Notice kind="error">{netWorthError}</Notice> : null}

        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void saveNetWorth()}
            disabled={savingNetWorth}
          >
            {savingNetWorth ? <Spinner label="Saving" /> : "Save net worth"}
          </button>
          {settings.netWorthConfigured ? (
            <button
              type="button"
              className="btn"
              onClick={() => void clearNetWorth()}
              disabled={savingNetWorth}
            >
              Reset to Not set
            </button>
          ) : null}
          <span className="cell-meta">
            {settings.netWorthConfigured
              ? `Currently ${money(settings.assets - settings.liabilities)}`
              : "Currently Not set"}
          </span>
        </div>
      </Card>

      {/* --------------------------------------------------- managed lists */}
      <div className="grid grid--3">
        <ManagedList
          title="Categories"
          hint="Used by pickers and rules. Removing one keeps the label on past transactions."
          items={settings.categories}
          onSave={(next) => savePreferences({ categories: next })}
        />
        <ManagedList
          title="Accounts"
          hint="Names only — Pocket Ledger never stores balances for an account."
          items={settings.accounts}
          onSave={(next) => savePreferences({ accounts: next })}
        />
        <ManagedList
          title="Tags"
          hint="A tag needs only a name."
          items={state.tags.map((tag) => tag.name)}
          onSave={(next) => savePreferences({ tags: next })}
        />
      </div>

      {/* ------------------------------------------------------- detection */}
      <Card>
        <CardHead title="Automatic detection" />
        <p className="page-intro">
          Pocket Ledger looks at your saved expenses and groups them by a cleaned-up
          merchant name. When the same merchant repeats on a steady interval —
          weekly, every two weeks, monthly, quarterly or annually — and the
          amount stays stable, it appears as a suggestion on the Recurring or
          Subscriptions page. A merchant with no recognizable subscription or
          bill hint needs at least three occurrences with almost no variation
          before it is suggested at all, so ordinary repeat shopping is not
          flagged. Nothing is ever confirmed for you: you choose Keep.
        </p>
        <div className="stat-line">
          <span className="stat-line__label">Ignored suggestions</span>
          <span className="stat-line__value">
            {settings.dismissedPatterns.length}
          </span>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn"
            onClick={() => void restoreIgnored()}
            disabled={restoring || settings.dismissedPatterns.length === 0}
          >
            {restoring ? (
              <Spinner label="Restoring" />
            ) : (
              <>
                <RotateCcw size={16} aria-hidden="true" />
                Restore ignored suggestions
              </>
            )}
          </button>
        </div>
      </Card>

      {/* ----------------------------------------------------- drive sync */}
      <Card>
        <CardHead
          title="Google Drive sync"
          action={
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => openModal("drive")}
            >
              <FolderSync size={15} aria-hidden="true" />
              Configure
            </button>
          }
        />
        <div className="stat-line">
          <span className="stat-line__label">Folder</span>
          <span className="stat-line__value">
            {settings.driveFolder ? (
              settings.driveFolder.url ? (
                <a
                  href={settings.driveFolder.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {settings.driveFolder.name}{" "}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              ) : (
                settings.driveFolder.name
              )
            ) : (
              "Not configured"
            )}
          </span>
        </div>
        <div className="stat-line">
          <span className="stat-line__label">Schedule</span>
          <span className="stat-line__value">
            Daily at {settings.driveSchedule.time} · {settings.driveSchedule.timezone}
          </span>
        </div>
        <div className="stat-line">
          <span className="stat-line__label">Last sync</span>
          <span className="stat-line__value">
            {formatTimestamp(settings.driveSync.lastSyncedAt)}
          </span>
        </div>
        <div className="stat-line">
          <span className="stat-line__label">Status</span>
          <span className="stat-line__value">{settings.driveSync.status}</span>
        </div>
        <div className="stat-line">
          <span className="stat-line__label">Imported / duplicates / review</span>
          <span className="stat-line__value">
            {settings.driveSync.imported} / {settings.driveSync.duplicates} /{" "}
            {settings.driveSync.review}
          </span>
        </div>
        {settings.driveSync.errors.length ? (
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            <p className="field__label">Errors</p>
            {settings.driveSync.errors.map((message, index) => (
              <p className="field__hint" key={index}>
                {message}
              </p>
            ))}
          </div>
        ) : null}
        <p className="card__hint" style={{ marginTop: 10 }}>
          Add a receipt, CSV, statement, invoice or other supported document to
          the dedicated folder and it will be checked at 8:00 AM daily. Pocket Ledger
          never displays or stores the automation's access token.
        </p>
      </Card>

      {/* ------------------------------------------------------- appearance */}
      <Card>
        <CardHead
          title="Appearance"
          hint="System follows your device's light/dark setting automatically."
        />
        <ThemePicker value={theme} onChange={setThemeChoice} />
      </Card>

      {/* ---------------------------------------------------------- session */}
      <Card>
        <CardHead
          title="Session"
          hint="Signed in with your Pocket Ledger account; the browser only holds a signed session cookie."
        />
        <button type="button" className="btn" onClick={() => void logout()}>
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ theme picker */

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

function ThemePicker({
  value,
  onChange,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Theme">
      {THEME_OPTIONS.map(({ value: option, label, icon: Icon }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={`segmented__item${value === option ? " segmented__item--active" : ""}`}
          onClick={() => onChange(option)}
        >
          <Icon size={15} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ managed list */

function ManagedList({
  title,
  hint,
  items,
  onSave,
}: {
  title: string;
  hint: string;
  items: string[];
  onSave: (next: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const inputId = useId();

  async function add() {
    const name = draft.trim();
    if (!name) {
      setError("Enter a name.");
      return;
    }
    if (items.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setError("That name already exists.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave([...items, name]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change was not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string) {
    setBusy(true);
    try {
      await onSave(items.filter((item) => item !== name));
      setRemoveTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead title={title} hint={hint} />

      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
        <input
          id={inputId}
          className="input"
          placeholder={`Add to ${title.toLowerCase()}`}
          aria-label={`Add to ${title.toLowerCase()}`}
          maxLength={60}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add();
            }
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => void add()}
          disabled={busy}
          aria-label={`Add ${title.toLowerCase()}`}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>

      {error ? (
        <p className="field__error" role="alert" style={{ marginTop: 6 }}>
          {error}
        </p>
      ) : null}

      <div style={{ marginTop: 10 }}>
        {items.length === 0 ? (
          <p className="field__hint">Nothing here yet.</p>
        ) : (
          items.map((item) => (
            <div className="list-row" key={item}>
              <span className="list-row__main list-row__title">{item}</span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setRemoveTarget(item)}
                aria-label={`Remove ${item}`}
                disabled={busy}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>

      {removeTarget ? (
        <ConfirmDialog
          title={`Remove “${removeTarget}”?`}
          body="It disappears from future pickers. Transactions that already use it keep their label."
          confirmLabel="Remove"
          busy={busy}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => void remove(removeTarget)}
        />
      ) : null}
    </Card>
  );
}
