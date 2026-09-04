import {
  AlertTriangle,
  CloudUpload,
  FolderSync,
  LogOut,
  Plus,
  RefreshCcw,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ForgotPasswordScreen,
  LoginScreen,
  RegisterScreen,
  ResetPasswordScreen,
  VerifyEmailScreen,
} from "./components/AuthScreens";
import { Notice, Spinner } from "./components/ui";
import { AddEntryModal } from "./modals/AddEntryModal";
import { DriveSyncModal } from "./modals/DriveSyncModal";
import { ImportModal } from "./modals/ImportModal";
import { NAV, routeFromHash, type RouteId } from "./nav";
import { Budgets } from "./pages/Budgets";
import { Dashboard } from "./pages/Dashboard";
import { Documents } from "./pages/Documents";
import { Goals } from "./pages/Goals";
import { Recurring } from "./pages/Recurring";
import { Rules } from "./pages/Rules";
import { Settings } from "./pages/Settings";
import { Subscriptions } from "./pages/Subscriptions";
import { Transactions } from "./pages/Transactions";
import { usePocketLedger } from "./store";

type GlobalModal = "add-entry" | "import" | "drive" | null;
type AuthView = "login" | "register" | "forgot-password";

/**
 * The backend's verification/reset-password emails link to real paths
 * (/verify-email, /reset-password), not the app's normal hash-based routes
 * — read once at load, since these are one-shot flows a token in the URL
 * drives, not something the in-app nav ever produces.
 */
function readTokenScreen(): { screen: "verify-email" | "reset-password"; token: string } | null {
  const { pathname, search } = window.location;
  const token = new URLSearchParams(search).get("token");
  if (!token) return null;
  if (pathname === "/verify-email") return { screen: "verify-email", token };
  if (pathname === "/reset-password") return { screen: "reset-password", token };
  return null;
}

interface UiContextValue {
  route: RouteId;
  navigate: (route: RouteId) => void;
  openModal: (modal: Exclude<GlobalModal, null>) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function useUi(): UiContextValue {
  const context = useContext(UiContext);
  if (!context) throw new Error("useUi must be used inside the app shell.");
  return context;
}

export default function App() {
  const {
    state,
    status,
    loadError,
    user,
    reload,
    toasts,
    notify,
    dismissToast,
    login,
    register,
    logout,
    resendVerification,
    forgotPassword,
    resetPassword,
    verifyEmail,
  } = usePocketLedger();
  const [route, setRoute] = useState<RouteId>(() =>
    routeFromHash(window.location.hash),
  );
  const [modal, setModal] = useState<GlobalModal>(null);
  const [authView, setAuthView] = useState<AuthView>("login");
  const [loginPrefill, setLoginPrefill] = useState<string | undefined>(undefined);
  const [tokenScreen] = useState(readTokenScreen);
  const [resendBusy, setResendBusy] = useState(false);

  useEffect(() => {
    function onHashChange() {
      setRoute(routeFromHash(window.location.hash));
      window.scrollTo({ top: 0 });
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: RouteId) => {
    window.location.hash = `#/${next}`;
    setRoute(next);
    window.scrollTo({ top: 0 });
  }, []);

  const openModal = useCallback((next: Exclude<GlobalModal, null>) => {
    setModal(next);
  }, []);

  const ui = useMemo<UiContextValue>(
    () => ({ route, navigate, openModal }),
    [route, navigate, openModal],
  );

  const entry = NAV.find((item) => item.id === route) ?? NAV[0];
  const needsReview =
    state?.transactions.filter((tx) => tx.category === "Needs review").length ?? 0;

  // Token-driven, one-shot screens from an email link take priority over
  // everything else — reachable whether or not there's already a session.
  if (tokenScreen?.screen === "verify-email") {
    return (
      <VerifyEmailScreen
        token={tokenScreen.token}
        onVerify={verifyEmail}
        onGoToLogin={() => {
          window.history.replaceState(null, "", "/");
          window.location.reload();
        }}
      />
    );
  }
  if (tokenScreen?.screen === "reset-password") {
    return (
      <ResetPasswordScreen
        token={tokenScreen.token}
        onSubmit={resetPassword}
        onGoToLogin={() => {
          window.history.replaceState(null, "", "/");
          window.location.reload();
        }}
      />
    );
  }

  // Nothing but the sign-in/register/forgot-password screens render until
  // the server accepts a session — real per-user accounts now, not one
  // shared owner passphrase.
  if (status === "locked") {
    if (authView === "register") {
      return (
        <RegisterScreen
          onSubmit={register}
          onGoToLogin={(justRegisteredEmail) => {
            setLoginPrefill(justRegisteredEmail);
            setAuthView("login");
          }}
        />
      );
    }
    if (authView === "forgot-password") {
      return (
        <ForgotPasswordScreen
          onSubmit={forgotPassword}
          onGoToLogin={() => setAuthView("login")}
        />
      );
    }
    return (
      <LoginScreen
        onSubmit={login}
        onGoToRegister={() => setAuthView("register")}
        onGoToForgotPassword={() => setAuthView("forgot-password")}
        prefillEmail={loginPrefill}
      />
    );
  }

  return (
    <UiContext.Provider value={ui}>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar__brand">
            <img
              className="brand__mark"
              src="/icon-192.png"
              alt=""
              width={36}
              height={36}
            />
            <span>
              <span className="brand__name">Pocket Ledger</span>
              <span className="brand__tag" style={{ display: "block" }}>
                Private finance
              </span>
            </span>
          </div>

          <nav className="sidebar__nav" aria-label="Main">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="nav-item"
                  aria-current={route === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.id === "transactions" && needsReview > 0 ? (
                    <span className="nav-item__badge">{needsReview}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="sidebar__footer">
            <p style={{ marginBottom: 8 }}>
              Signed in as {user?.email}. Data is stored on your Pocket Ledger server —
              not in this browser.
            </p>
            <button
              type="button"
              className="btn btn--sm btn--block"
              onClick={() => void logout()}
            >
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="topbar__titles">
              <h1 className="topbar__title">{entry.label}</h1>
              <p className="topbar__subtitle">{entry.subtitle}</p>
            </div>
            <div className="topbar__actions">
              <GlobalActions onOpen={openModal} disabled={status !== "ready"} />
            </div>
          </header>

          <header className="mobile-topbar">
            <img
              className="brand__mark"
              src="/icon-192.png"
              alt=""
              width={32}
              height={32}
            />
            <h1 className="mobile-topbar__title">{entry.label}</h1>
            <GlobalActions
              onOpen={openModal}
              disabled={status !== "ready"}
              compact
            />
          </header>

          <main className="page" id="main-content">
            {user && !user.emailVerified ? (
              <Notice kind="warn">
                <span>Please verify {user.email} to keep using Pocket Ledger.</span>{" "}
                <button
                  type="button"
                  className="link-btn"
                  disabled={resendBusy}
                  onClick={async () => {
                    setResendBusy(true);
                    try {
                      await resendVerification(user.email);
                      notify("Verification email sent.");
                    } catch {
                      notify("Could not send a verification email right now.", "error");
                    } finally {
                      setResendBusy(false);
                    }
                  }}
                >
                  {resendBusy ? "Sending…" : "Resend email"}
                </button>
              </Notice>
            ) : null}
            {status === "loading" ? (
              <div className="loading-page">
                <Spinner label="Loading your Pocket Ledger data…" />
              </div>
            ) : status === "error" ? (
              <div className="stack" style={{ maxWidth: 560 }}>
                <Notice kind="error">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <span>{loadError}</span>
                </Notice>
                <div>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void reload()}
                  >
                    <RefreshCcw size={16} aria-hidden="true" />
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <PageBody route={route} />
            )}
          </main>
        </div>

        <nav className="bottom-nav" aria-label="Main">
          <div className="bottom-nav__scroll">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="bottom-nav__item"
                  aria-current={route === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {modal === "add-entry" ? (
        <AddEntryModal onClose={() => setModal(null)} />
      ) : null}
      {modal === "import" ? <ImportModal onClose={() => setModal(null)} /> : null}
      {modal === "drive" ? <DriveSyncModal onClose={() => setModal(null)} /> : null}

      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`}>
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button
              type="button"
              className="toast__close"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </UiContext.Provider>
  );
}

function GlobalActions({
  onOpen,
  disabled,
  compact = false,
}: {
  onOpen: (modal: Exclude<GlobalModal, null>) => void;
  disabled: boolean;
  compact?: boolean;
}) {
  return (
    <>
      <button
        type="button"
        className={compact ? "btn btn--icon" : "btn"}
        onClick={() => onOpen("drive")}
        disabled={disabled}
        aria-label="Drive sync"
        title="Drive sync"
      >
        <FolderSync size={16} aria-hidden="true" />
        {compact ? null : <span>Drive sync</span>}
      </button>
      <button
        type="button"
        className={compact ? "btn btn--icon" : "btn"}
        onClick={() => onOpen("import")}
        disabled={disabled}
        aria-label="Import"
        title="Import"
      >
        <CloudUpload size={16} aria-hidden="true" />
        {compact ? null : <span>Import</span>}
      </button>
      <button
        type="button"
        className={compact ? "btn btn--primary btn--icon" : "btn btn--primary"}
        onClick={() => onOpen("add-entry")}
        disabled={disabled}
        aria-label="Add entry"
        title="Add entry"
      >
        <Plus size={17} aria-hidden="true" />
        {compact ? null : <span>Add entry</span>}
      </button>
    </>
  );
}

function PageBody({ route }: { route: RouteId }): ReactNode {
  switch (route) {
    case "dashboard":
      return <Dashboard />;
    case "transactions":
      return <Transactions />;
    case "recurring":
      return <Recurring />;
    case "subscriptions":
      return <Subscriptions />;
    case "budgets":
      return <Budgets />;
    case "goals":
      return <Goals />;
    case "documents":
      return <Documents />;
    case "rules":
      return <Rules />;
    case "settings":
      return <Settings />;
  }
}
