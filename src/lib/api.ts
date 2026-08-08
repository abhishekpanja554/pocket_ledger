import type {
  AppState,
  DocumentRow,
  Rule,
  Settings,
  Tag,
  Transaction,
  TransactionInput,
  TransactionWriteResult,
} from "../../shared/types";
import { WIPE_CONFIRMATION } from "../../shared/types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      "Could not reach the Pocket Ledger server. Your change was not saved.",
      0,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

/** Every field optional — the server changes only what is sent. */
export interface TransactionPatch {
  date?: string;
  merchant?: string;
  amount?: number;
  type?: "expense" | "income";
  category?: string;
  account?: string;
  tags?: string[];
  receipt?: boolean;
}

export interface AuthStatus {
  required: boolean;
  misconfigured: boolean;
  authenticated: boolean;
}

export const api = {
  authStatus(): Promise<AuthStatus> {
    return request<AuthStatus>("/api/auth/status");
  },

  login(password: string): Promise<{ ok: true }> {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  logout(): Promise<{ ok: true }> {
    return request("/api/auth/logout", { method: "POST" });
  },

  getState(): Promise<AppState> {
    return request<AppState>("/api/state");
  },

  addTransactions(
    transactions: TransactionInput[],
    options: { applyRules?: boolean } = {},
  ): Promise<TransactionWriteResult> {
    return request<TransactionWriteResult>("/api/transactions", {
      method: "POST",
      body: JSON.stringify({
        transactions,
        applyRules: options.applyRules ?? false,
      }),
    });
  },

  updateTransaction(
    id: string,
    patch: TransactionPatch,
  ): Promise<{ ok: true; transaction: Transaction }> {
    return request(`/api/transactions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  deleteTransaction(id: string): Promise<{ ok: true }> {
    return request(`/api/transactions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  savePreferences(
    patch: Partial<Settings> & {
      tags?: string[];
      rules?: Rule[];
      stripTagsFromTransactions?: string[];
    },
  ): Promise<{ ok: true; settings: Settings; tags: Tag[]; rules: Rule[] }> {
    return request("/api/preferences", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },

  uploadDocuments(
    files: File[],
    status?: "queued" | "stored" | "review",
  ): Promise<{ stored: DocumentRow[]; errors: string[] }> {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    if (status) form.append("status", status);
    return request("/api/documents", { method: "POST", body: form });
  },

  deleteDocument(id: string): Promise<{ ok: true }> {
    return request(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  documentUrl(id: string): string {
    return `/api/documents/${encodeURIComponent(id)}/file`;
  },

  wipeEverything(): Promise<{ ok: true; settings: Settings }> {
    return request("/api/state", {
      method: "DELETE",
      body: JSON.stringify({ confirm: WIPE_CONFIRMATION }),
    });
  },
};
