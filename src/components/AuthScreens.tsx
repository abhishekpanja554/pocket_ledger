import { Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ApiError, type AuthUser } from "../lib/api";
import { Field, Notice, Spinner } from "./ui";

/** A password input with a show/hide toggle — every password field uses this. */
function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        id={id}
        className="input"
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="password-field__toggle"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {visible ? (
          <EyeOff size={16} aria-hidden="true" />
        ) : (
          <Eye size={16} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

/**
 * Every screen here shares the same card shell the old passphrase-only
 * LoginScreen used — only the form inside changes. Real per-user accounts
 * now (register/login/verify-email/forgot-reset), not one shared owner
 * passphrase, since the backend is genuinely multi-tenant.
 */
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login">
      <div className="login__card card">
        <div className="login__brand">
          <img
            className="brand__mark brand__mark--lg"
            src="/icon-192.png"
            alt=""
            width={44}
            height={44}
          />
          <div>
            <p className="brand__name">Pocket Ledger</p>
            <p className="brand__tag">Private finance</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ==================================================================== login */

export function LoginScreen({
  onSubmit,
  onGoToRegister,
  onGoToForgotPassword,
  prefillEmail,
}: {
  onSubmit: (email: string, password: string) => Promise<void>;
  onGoToRegister: () => void;
  onGoToForgotPassword: () => void;
  prefillEmail?: string;
}) {
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState(prefillEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email, password);
    } catch (err) {
      setError(messageFor(err, "That email or password is not correct."));
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="login__title">Sign in</h1>
      <p className="login__text">Your financial data is only served after you sign in.</p>

      <form onSubmit={submit} className="stack" noValidate>
        {error ? <Notice kind="error">{error}</Notice> : null}

        <Field label="Email" htmlFor={emailId}>
          <input
            id={emailId}
            className="input"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field label="Password" htmlFor={passwordId}>
          <PasswordField
            id={passwordId}
            value={password}
            autoComplete="current-password"
            onChange={(value) => {
              setPassword(value);
              setError(null);
            }}
          />
        </Field>

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? (
            <Spinner label="Signing in" />
          ) : (
            <>
              <KeyRound size={16} aria-hidden="true" />
              Sign in
            </>
          )}
        </button>
      </form>

      <div className="login__links">
        <button type="button" className="link-btn" onClick={onGoToForgotPassword}>
          Forgot password?
        </button>
        <button type="button" className="link-btn" onClick={onGoToRegister}>
          Create an account
        </button>
      </div>

      <p className="login__footnote">
        <Lock size={13} aria-hidden="true" /> Data is stored on your own Pocket Ledger
        server.
      </p>
    </AuthShell>
  );
}

/* ================================================================= register */

export function RegisterScreen({
  onSubmit,
  onGoToLogin,
}: {
  onSubmit: (email: string, password: string) => Promise<AuthUser>;
  onGoToLogin: (justRegisteredEmail?: string) => void;
}) {
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email || !password) {
      setError("Enter an email and password.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email, password);
      onGoToLogin(email);
    } catch (err) {
      setError(messageFor(err, "Could not create that account."));
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="login__title">Create your account</h1>
      <p className="login__text">Your own private Pocket Ledger — nobody else can see it.</p>

      <form onSubmit={submit} className="stack" noValidate>
        {error ? <Notice kind="error">{error}</Notice> : null}

        <Field label="Email" htmlFor={emailId}>
          <input
            id={emailId}
            className="input"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field label="Password" hint="At least 8 characters." htmlFor={passwordId}>
          <PasswordField
            id={passwordId}
            value={password}
            autoComplete="new-password"
            onChange={(value) => {
              setPassword(value);
              setError(null);
            }}
          />
        </Field>

        <Field label="Confirm password" htmlFor={confirmId}>
          <PasswordField
            id={confirmId}
            value={confirm}
            autoComplete="new-password"
            onChange={(value) => {
              setConfirm(value);
              setError(null);
            }}
          />
        </Field>

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? <Spinner label="Creating account" /> : "Create account"}
        </button>
      </form>

      <div className="login__links">
        <button type="button" className="link-btn" onClick={() => onGoToLogin()}>
          Already have an account? Sign in
        </button>
      </div>
    </AuthShell>
  );
}

/* ========================================================== forgot password */

export function ForgotPasswordScreen({
  onSubmit,
  onGoToLogin,
}: {
  onSubmit: (email: string) => Promise<void>;
  onGoToLogin: () => void;
}) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email) {
      setError("Enter your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email);
      setSent(true);
    } catch (err) {
      setError(messageFor(err, "Could not send a reset link right now."));
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthShell>
        <h1 className="login__title">Check your email</h1>
        <Notice kind="success">
          If an account exists for {email}, a password reset link is on its way.
        </Notice>
        <div className="login__links">
          <button type="button" className="link-btn" onClick={onGoToLogin}>
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="login__title">Reset your password</h1>
      <p className="login__text">
        Enter your email and we'll send you a link to choose a new password.
      </p>

      <form onSubmit={submit} className="stack" noValidate>
        {error ? <Notice kind="error">{error}</Notice> : null}

        <Field label="Email" htmlFor={emailId}>
          <input
            id={emailId}
            className="input"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
          />
        </Field>

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? (
            <Spinner label="Sending" />
          ) : (
            <>
              <Mail size={16} aria-hidden="true" />
              Send reset link
            </>
          )}
        </button>
      </form>

      <div className="login__links">
        <button type="button" className="link-btn" onClick={onGoToLogin}>
          Back to sign in
        </button>
      </div>
    </AuthShell>
  );
}

/* =========================================================== reset password */

export function ResetPasswordScreen({
  token,
  onSubmit,
  onGoToLogin,
}: {
  token: string;
  onSubmit: (token: string, newPassword: string) => Promise<void>;
  onGoToLogin: () => void;
}) {
  const passwordId = useId();
  const confirmId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(token, password);
      setDone(true);
    } catch (err) {
      setError(
        messageFor(err, "That reset link is invalid or has expired. Request a new one."),
      );
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell>
        <h1 className="login__title">Password updated</h1>
        <Notice kind="success">
          Your password has been reset. Sign in with your new password.
        </Notice>
        <div className="login__links">
          <button type="button" className="link-btn" onClick={onGoToLogin}>
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="login__title">Choose a new password</h1>

      <form onSubmit={submit} className="stack" noValidate>
        {error ? <Notice kind="error">{error}</Notice> : null}

        <Field label="New password" hint="At least 8 characters." htmlFor={passwordId}>
          <PasswordField
            id={passwordId}
            value={password}
            autoComplete="new-password"
            autoFocus
            onChange={(value) => {
              setPassword(value);
              setError(null);
            }}
          />
        </Field>

        <Field label="Confirm new password" htmlFor={confirmId}>
          <PasswordField
            id={confirmId}
            value={confirm}
            autoComplete="new-password"
            onChange={(value) => {
              setConfirm(value);
              setError(null);
            }}
          />
        </Field>

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? <Spinner label="Saving" /> : "Reset password"}
        </button>
      </form>
    </AuthShell>
  );
}

/* ============================================================= verify email */

export function VerifyEmailScreen({
  token,
  onVerify,
  onGoToLogin,
}: {
  token: string;
  onVerify: (token: string) => Promise<void>;
  onGoToLogin: () => void;
}) {
  const [state, setState] = useState<"verifying" | "done" | "error">("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    onVerify(token)
      .then(() => {
        if (!cancelled) setState("done");
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(messageFor(err, "That verification link is invalid or has expired."));
          setState("error");
        }
      });
    return () => {
      cancelled = true;
    };
    // Verifying is a one-shot action tied to the token in the URL, not to
    // identity changes of the callback prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <AuthShell>
      {state === "verifying" ? (
        <>
          <h1 className="login__title">Verifying your email…</h1>
          <Spinner label="Verifying" />
        </>
      ) : state === "done" ? (
        <>
          <h1 className="login__title">Email verified</h1>
          <Notice kind="success">
            <ShieldCheck size={16} aria-hidden="true" /> Your email is confirmed. You can
            sign in now.
          </Notice>
          <div className="login__links">
            <button type="button" className="link-btn" onClick={onGoToLogin}>
              Go to sign in
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="login__title">Verification failed</h1>
          <Notice kind="error">{error}</Notice>
          <div className="login__links">
            <button type="button" className="link-btn" onClick={onGoToLogin}>
              Go to sign in
            </button>
          </div>
        </>
      )}
    </AuthShell>
  );
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
