import type {
  AppState,
  DocumentRow,
  DriveSyncMeta,
  Rule,
  Settings,
  Tag,
  Transaction,
  TransactionInput,
  TransactionWriteResult,
} from "../../shared/types";

/**
 * The backend now lives on its own subdomain (api.pocketledgerapp.com),
 * separate from wherever this frontend is served from — so every request
 * needs an absolute URL, not a same-origin relative path like the old
 * Worker deployment could get away with.
 *
 * Set per environment in .env.production / .env.development (see those
 * files for why: CORS on the deployed backend only allows the real
 * app.pocketledgerapp.com origin, not the local Vite dev server). Override
 * further with a gitignored .env.local if needed.
 */
const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? "https://api.pocketledgerapp.com";

export class ApiError extends Error {
  status: number;
  /** Machine-readable error code from the backend (e.g. "INVALID_CREDENTIALS"), when present. */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Every response is wrapped in this envelope now — {status, data} or {status, errorDetails}. */
interface ApiEnvelope<T> {
  status: "SUCCESS" | "ERROR";
  data?: T;
  errorDetails?: { code: string; message: string };
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutating = method !== "GET" && method !== "HEAD";
  // The backend issues an XSRF-TOKEN cookie and expects it echoed back as a
  // header on every state-changing request; GETs don't need it.
  const csrfToken = isMutating ? readCookie("XSRF-TOKEN") : null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      // Cross-origin now, so the session cookie won't be sent without this.
      credentials: "include",
      headers: {
        ...(init?.body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
        ...(csrfToken ? { "X-XSRF-TOKEN": csrfToken } : {}),
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
  let payload: ApiEnvelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload?.errorDetails?.message ?? `Request failed (${response.status}).`;
    throw new ApiError(message, response.status, payload?.errorDetails?.code);
  }

  return (payload?.data ?? null) as T;
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

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  fullName: string | null;
  locale: string;
  currency: string;
}

/** Every field optional — omitted means "leave as is", same convention as TransactionPatch. */
export interface ProfilePatch {
  fullName?: string;
  locale?: string;
  currency?: string;
}

export const api = {
  /** Who's currently signed in, if anyone — throws a 401 ApiError when not. */
  me(): Promise<AuthUser> {
    return request<AuthUser>("/api/auth/me");
  },

  register(email: string, password: string): Promise<AuthUser> {
    return request<AuthUser>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  login(email: string, password: string): Promise<AuthUser> {
    return request<AuthUser>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  logout(): Promise<void> {
    return request("/api/auth/logout", { method: "POST" });
  },

  verifyEmail(token: string): Promise<void> {
    return request("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },

  resendVerification(email: string): Promise<void> {
    return request("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  forgotPassword(email: string): Promise<void> {
    return request("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  resetPassword(token: string, newPassword: string): Promise<void> {
    return request("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    });
  },

  updateProfile(patch: ProfilePatch): Promise<AuthUser> {
    return request<AuthUser>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  /** Re-verifies the current password server-side. Invalidates every active session on success. */
  changePassword(oldPassword: string, newPassword: string): Promise<void> {
    return request("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  },

  /** Irreversible — deletes the account, every transaction/document/setting, and all sessions. */
  deleteAccount(password: string): Promise<void> {
    return request("/api/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
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

  updateTransaction(id: string, patch: TransactionPatch): Promise<Transaction> {
    return request<Transaction>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  deleteTransaction(id: string): Promise<void> {
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
  ): Promise<{ settings: Settings; tags: Tag[]; rules: Rule[] }> {
    return request("/api/preferences", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },

  uploadDocuments(
    files: File[],
    status?: "queued" | "stored" | "review",
  ): Promise<{ documents: DocumentRow[]; errors: string[] }> {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    if (status) form.append("status", status);
    return request("/api/documents", { method: "POST", body: form });
  },

  deleteDocument(id: string): Promise<void> {
    return request(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  documentUrl(id: string): string {
    return `${API_BASE_URL}/api/documents/${encodeURIComponent(id)}/file`;
  },

  /**
   * Manually trigger a Drive sync run right now, instead of waiting for the
   * daily scheduled automation. New — the old Worker never had a
   * user-facing trigger for this, only the automation itself could call it.
   */
  runDriveSync(): Promise<DriveSyncMeta> {
    return request<DriveSyncMeta>("/api/sync/run", { method: "POST" });
  },
};
