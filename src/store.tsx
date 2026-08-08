import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AppState,
  DocumentRow,
  PeriodId,
  Rule,
  Settings,
  Tag,
  Transaction,
  TransactionInput,
  TransactionWriteResult,
} from "../shared/types";
import { ApiError, api, type TransactionPatch } from "./lib/api";

export type LoadStatus = "loading" | "ready" | "error" | "locked";

export interface Toast {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
}

interface PocketLedgerContextValue {
  state: AppState | null;
  status: LoadStatus;
  loadError: string | null;
  /** True when the deployment has no owner passphrase configured. */
  authMisconfigured: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  toasts: Toast[];
  notify: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  reload: () => Promise<void>;

  setPeriod: (period: PeriodId) => Promise<void>;
  addTransactions: (
    inputs: TransactionInput[],
    options?: { applyRules?: boolean },
  ) => Promise<TransactionWriteResult>;
  updateTransaction: (id: string, patch: TransactionPatch) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  savePreferences: (
    patch: Partial<Settings> & {
      tags?: string[];
      rules?: Rule[];
      stripTagsFromTransactions?: string[];
    },
  ) => Promise<void>;
  uploadDocuments: (
    files: File[],
    status?: DocumentRow["status"],
  ) => Promise<{ stored: DocumentRow[]; errors: string[] }>;
  deleteDocument: (id: string) => Promise<void>;
  wipeEverything: () => Promise<void>;
}

const PocketLedgerContext = createContext<PocketLedgerContextValue | null>(null);

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}

export function PocketLedgerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authMisconfigured, setAuthMisconfigured] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback(
    (message: string, kind: Toast["kind"] = "success") => {
      const id = ++toastId.current;
      setToasts((current) => [...current, { id, message, kind }]);
      setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, 5200);
    },
    [],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await api.getState();
      setState(next);
      setStatus("ready");
      setLoadError(null);
    } catch (error) {
      // A 401 anywhere means the session lapsed — show the sign-in screen
      // rather than a generic failure, and drop the cached data.
      if (error instanceof ApiError && error.status === 401) {
        setState(null);
        setStatus("locked");
        return;
      }
      if (error instanceof ApiError && error.status === 503) {
        setAuthMisconfigured(true);
        setState(null);
        setStatus("locked");
        return;
      }
      setStatus("error");
      setLoadError(
        messageFor(error, "Pocket Ledger could not load your data from the server."),
      );
    }
  }, []);

  const login = useCallback(
    async (password: string) => {
      await api.login(password);
      setStatus("loading");
      await reload();
    },
    [reload],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setState(null);
    setStatus("locked");
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* ------------------------------------------------------------- mutations */

  const setPeriod = useCallback(
    async (period: PeriodId) => {
      const previous = state?.settings.selectedPeriod ?? "all-time";
      if (period === previous) return;

      // Optimistic so the UI never lags behind the control...
      setState((current) =>
        current
          ? { ...current, settings: { ...current.settings, selectedPeriod: period } }
          : current,
      );

      try {
        const saved = await api.savePreferences({ selectedPeriod: period });
        setState((current) =>
          current ? { ...current, settings: saved.settings } : current,
        );
      } catch (error) {
        // ...and restored exactly if the save fails.
        setState((current) =>
          current
            ? {
                ...current,
                settings: { ...current.settings, selectedPeriod: previous },
              }
            : current,
        );
        notify(
          messageFor(error, "The date period could not be saved."),
          "error",
        );
      }
    },
    [notify, state?.settings.selectedPeriod],
  );

  const addTransactions = useCallback(
    async (inputs: TransactionInput[], options?: { applyRules?: boolean }) => {
      const result = await api.addTransactions(inputs, options);
      await reload();
      return result;
    },
    [reload],
  );

  const updateTransaction = useCallback(
    async (id: string, patch: TransactionPatch) => {
      const saved = await api.updateTransaction(id, patch);
      setState((current) => {
        if (!current) return current;
        const transactions = current.transactions.map((tx: Transaction) =>
          tx.id === id ? saved.transaction : tx,
        );
        const knownTags = new Set(current.tags.map((t) => t.name.toLowerCase()));
        const newTags: Tag[] = saved.transaction.tags
          .filter((name) => !knownTags.has(name.toLowerCase()))
          .map((name) => ({ name, createdAt: new Date().toISOString() }));
        return {
          ...current,
          transactions,
          tags: [...current.tags, ...newTags].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        };
      });
    },
    [],
  );

  const deleteTransaction = useCallback(async (id: string) => {
    await api.deleteTransaction(id);
    setState((current) =>
      current
        ? {
            ...current,
            transactions: current.transactions.filter((tx) => tx.id !== id),
          }
        : current,
    );
  }, []);

  const savePreferences = useCallback<PocketLedgerContextValue["savePreferences"]>(
    async (patch) => {
      const saved = await api.savePreferences(patch);
      setState((current) =>
        current
          ? {
              ...current,
              settings: saved.settings,
              tags: saved.tags,
              rules: saved.rules,
            }
          : current,
      );
      if (patch.stripTagsFromTransactions?.length) await reload();
    },
    [reload],
  );

  const uploadDocuments = useCallback(
    async (files: File[], docStatus?: DocumentRow["status"]) => {
      const result = await api.uploadDocuments(files, docStatus);
      if (result.stored.length) {
        setState((current) =>
          current
            ? { ...current, documents: [...result.stored, ...current.documents] }
            : current,
        );
      }
      return result;
    },
    [],
  );

  const deleteDocument = useCallback(async (id: string) => {
    await api.deleteDocument(id);
    setState((current) =>
      current
        ? { ...current, documents: current.documents.filter((d) => d.id !== id) }
        : current,
    );
  }, []);

  const wipeEverything = useCallback(async () => {
    await api.wipeEverything();
    await reload();
  }, [reload]);

  const value = useMemo<PocketLedgerContextValue>(
    () => ({
      state,
      status,
      loadError,
      authMisconfigured,
      login,
      logout,
      toasts,
      notify,
      dismissToast,
      reload,
      setPeriod,
      addTransactions,
      updateTransaction,
      deleteTransaction,
      savePreferences,
      uploadDocuments,
      deleteDocument,
      wipeEverything,
    }),
    [
      state,
      status,
      loadError,
      authMisconfigured,
      login,
      logout,
      toasts,
      notify,
      dismissToast,
      reload,
      setPeriod,
      addTransactions,
      updateTransaction,
      deleteTransaction,
      savePreferences,
      uploadDocuments,
      deleteDocument,
      wipeEverything,
    ],
  );

  return (
    <PocketLedgerContext.Provider value={value}>{children}</PocketLedgerContext.Provider>
  );
}

export function usePocketLedger(): PocketLedgerContextValue {
  const context = useContext(PocketLedgerContext);
  if (!context) {
    throw new Error("usePocketLedger must be used inside <PocketLedgerProvider>.");
  }
  return context;
}

/** Convenience hook for pages that only render once state is ready. */
export function useAppState(): AppState {
  const { state } = usePocketLedger();
  if (!state) throw new Error("App state is not loaded yet.");
  return state;
}
