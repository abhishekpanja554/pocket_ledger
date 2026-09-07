import { AlertTriangle, KeyRound, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { ApiError } from "../lib/api";
import { usePocketLedger } from "../store";
import { PasswordField } from "./AuthScreens";
import { Card, CardHead, ConfirmDialog, Field, Notice, Spinner } from "./ui";

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const LOCALE_PATTERN = /^[a-z]{2}-[A-Z]{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * The account-level counterpart to Settings' app-preferences cards: identity
 * (name/locale/currency — stored only, nothing reads these yet), credentials,
 * and account deletion. None of this existed on the frontend before — the
 * backend endpoints (PATCH /api/auth/me, POST /api/auth/change-password,
 * DELETE /api/auth/me) shipped with no UI wired to them.
 */
export function AccountSettings() {
  return (
    <>
      <ProfileCard />
      <ChangePasswordCard />
      <DangerZoneCard />
    </>
  );
}

/* ================================================================= profile */

function ProfileCard() {
  const { user, updateProfile, notify } = usePocketLedger();
  const ids = { fullName: useId(), locale: useId(), currency: useId() };

  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [locale, setLocale] = useState(user?.locale ?? "");
  const [currency, setCurrency] = useState(user?.currency ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function save() {
    const trimmedName = fullName.trim();
    const trimmedLocale = locale.trim();
    const trimmedCurrency = currency.trim().toUpperCase();

    if (trimmedName.length > 100) {
      setError("Full name must be at most 100 characters.");
      return;
    }
    if (!LOCALE_PATTERN.test(trimmedLocale)) {
      setError("Locale must look like en-IN.");
      return;
    }
    if (!CURRENCY_PATTERN.test(trimmedCurrency)) {
      setError("Currency must be a 3-letter code, like INR.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await updateProfile({
        fullName: trimmedName,
        locale: trimmedLocale,
        currency: trimmedCurrency,
      });
      setFullName(trimmedName);
      setLocale(trimmedLocale);
      setCurrency(trimmedCurrency);
      notify("Profile saved.");
    } catch (err) {
      setError(messageFor(err, "That change was not saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead
        title="Profile"
        hint="Stored on your account. Nothing in Pocket Ledger reads these yet — the app's number/date formatting is unaffected."
      />

      <div className="grid grid--2">
        <Field label="Full name" htmlFor={ids.fullName}>
          <input
            id={ids.fullName}
            className="input"
            type="text"
            autoComplete="name"
            maxLength={100}
            placeholder="Optional"
            value={fullName}
            onChange={(event) => {
              setFullName(event.target.value);
              setError(null);
            }}
          />
        </Field>
        <div className="grid grid--2">
          <Field label="Locale" hint="e.g. en-IN" htmlFor={ids.locale}>
            <input
              id={ids.locale}
              className="input"
              type="text"
              placeholder="en-IN"
              value={locale}
              onChange={(event) => {
                setLocale(event.target.value);
                setError(null);
              }}
            />
          </Field>
          <Field label="Currency" hint="e.g. INR" htmlFor={ids.currency}>
            <input
              id={ids.currency}
              className="input"
              type="text"
              maxLength={3}
              placeholder="INR"
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value.toUpperCase());
                setError(null);
              }}
            />
          </Field>
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <div className="row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void save()}
          disabled={busy}
        >
          {busy ? <Spinner label="Saving" /> : "Save profile"}
        </button>
      </div>
    </Card>
  );
}

/* ======================================================== change password */

function ChangePasswordCard() {
  const { changePassword } = usePocketLedger();
  const ids = { current: useId(), next: useId(), confirm: useId() };

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!current) {
      setError("Enter your current password.");
      return;
    }
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // On success this ends the session — every device gets signed out,
      // including this tab, which drops straight back to the sign-in screen.
      await changePassword(current, next);
    } catch (err) {
      setError(messageFor(err, "That password was not changed."));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead
        title="Change password"
        hint="Signs every device out, including this one, once it succeeds."
      />

      <form onSubmit={submit} className="stack" noValidate>
        {error ? <Notice kind="error">{error}</Notice> : null}

        <Field label="Current password" htmlFor={ids.current}>
          <PasswordField
            id={ids.current}
            value={current}
            autoComplete="current-password"
            onChange={(value) => {
              setCurrent(value);
              setError(null);
            }}
          />
        </Field>

        <div className="grid grid--2">
          <Field label="New password" hint="At least 8 characters." htmlFor={ids.next}>
            <PasswordField
              id={ids.next}
              value={next}
              autoComplete="new-password"
              onChange={(value) => {
                setNext(value);
                setError(null);
              }}
            />
          </Field>
          <Field label="Confirm new password" htmlFor={ids.confirm}>
            <PasswordField
              id={ids.confirm}
              value={confirm}
              autoComplete="new-password"
              onChange={(value) => {
                setConfirm(value);
                setError(null);
              }}
            />
          </Field>
        </div>

        <div>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? (
              <Spinner label="Changing password" />
            ) : (
              <>
                <KeyRound size={16} aria-hidden="true" />
                Change password
              </>
            )}
          </button>
        </div>
      </form>
    </Card>
  );
}

/* ============================================================= danger zone */

function DangerZoneCard() {
  const { user, deleteAccount } = usePocketLedger();
  const passwordId = useId();

  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setConfirming(false);
    setPassword("");
    setError(null);
  }

  async function confirmDelete() {
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // On success this ends the session too — drops straight back to the
      // sign-in screen, same as changing the password.
      await deleteAccount(password);
    } catch (err) {
      setError(messageFor(err, "That account was not deleted."));
      setBusy(false);
    }
  }

  return (
    <Card className="danger-zone">
      <CardHead
        title="Danger zone"
        hint="Deletes your account and everything in it — transactions, documents, tags, rules, and settings. This cannot be undone."
      />
      <button
        type="button"
        className="btn btn--danger"
        onClick={() => setConfirming(true)}
      >
        <Trash2 size={16} aria-hidden="true" />
        Delete account
      </button>

      {confirming ? (
        <ConfirmDialog
          title="Delete your account?"
          confirmLabel="Delete account"
          busy={busy}
          onCancel={close}
          onConfirm={() => void confirmDelete()}
          body={
            <div className="stack">
              <Notice kind="warn">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>
                  This permanently deletes {user?.email}'s account — every
                  transaction, document, tag, rule, and setting. There is no
                  undo.
                </span>
              </Notice>
              {error ? <Notice kind="error">{error}</Notice> : null}
              <Field label="Confirm your password" htmlFor={passwordId}>
                <PasswordField
                  id={passwordId}
                  value={password}
                  autoComplete="current-password"
                  autoFocus
                  onChange={(value) => {
                    setPassword(value);
                    setError(null);
                  }}
                />
              </Field>
            </div>
          }
        />
      ) : null}
    </Card>
  );
}
