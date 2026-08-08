import { KeyRound, Lock } from "lucide-react";
import { useId, useState } from "react";
import { Field, Notice, Spinner } from "./ui";

/**
 * Owner sign-in. The passphrase is only ever sent to the server, which sets an
 * HttpOnly session cookie — nothing is stored in the browser by this screen.
 */
export function LoginScreen({
  onSubmit,
  misconfigured,
}: {
  onSubmit: (password: string) => Promise<void>;
  misconfigured: boolean;
}) {
  const passwordId = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Enter your passphrase.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That passphrase is not correct.",
      );
      setPassword("");
      setBusy(false);
    }
  }

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

        {misconfigured ? (
          <Notice kind="error">
            This deployment has no owner passphrase set. Run{" "}
            <code>wrangler secret put LEDGERLY_PASSWORD</code> and redeploy.
          </Notice>
        ) : (
          <>
            <h1 className="login__title">Sign in</h1>
            <p className="login__text">
              Your financial data is only served after you sign in.
            </p>

            <form onSubmit={submit} className="stack" noValidate>
              {error ? <Notice kind="error">{error}</Notice> : null}

              <Field label="Passphrase" htmlFor={passwordId}>
                <input
                  id={passwordId}
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError(null);
                  }}
                />
              </Field>

              <button
                type="submit"
                className="btn btn--primary btn--block"
                disabled={busy}
              >
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
          </>
        )}

        <p className="login__footnote">
          <Lock size={13} aria-hidden="true" /> Data is stored in your own D1
          database and R2 bucket.
        </p>
      </div>
    </div>
  );
}
