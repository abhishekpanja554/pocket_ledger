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
import { LoginScreen } from "./components/LoginScreen";
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
    reload,
    toasts,
    dismissToast,
    login,
    logout,
    authMisconfigured,
  } = usePocketLedger();
  const [route, setRoute] = useState<RouteId>(() =>
    routeFromHash(window.location.hash),
  );
  const [modal, setModal] = useState<GlobalModal>(null);

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

  // Nothing but the sign-in screen renders until the server accepts a session.
  if (status === "locked") {
    return (
      <LoginScreen onSubmit={login} misconfigured={authMisconfigured} />
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
              Data is stored on your Pocket Ledger server in D1 and R2 — not in this
              browser.
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
