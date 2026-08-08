import type { Env } from "./db";
import { timingSafeEqual } from "./util";

/**
 * Owner login for the deployed app.
 *
 * The passphrase lives in the `LEDGERLY_PASSWORD` secret and is compared
 * server-side. A successful login issues an HMAC-signed, HttpOnly session
 * cookie; nothing about the session is trusted from the client.
 *
 * Only the API is gated. The HTML/JS bundle is not secret — every piece of
 * financial data is fetched through `/api/*`, which requires the session.
 */

const COOKIE_NAME = "ledgerly_session";
const SESSION_DAYS = 30;

/* ------------------------------------------------------------------ signing */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

/**
 * The signing secret. `SESSION_SECRET` is preferred; otherwise it is derived
 * from the password so a single secret is enough to get started. Rotating the
 * password therefore invalidates existing sessions, which is the safe default.
 */
function signingSecret(env: Env): string {
  return env.SESSION_SECRET || `ledgerly:${env.LEDGERLY_PASSWORD ?? ""}`;
}

/* ------------------------------------------------------------------ cookies */

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function cookieAttributes(request: Request, maxAge: number): string {
  const isHttps = new URL(request.url).protocol === "https:";
  return [
    `Path=/`,
    `HttpOnly`,
    // Lax still sends the cookie on top-level GETs (document downloads) while
    // blocking cross-site POSTs, which is the CSRF protection this app needs.
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
    isHttps ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export async function createSessionCookie(
  request: Request,
  env: Env,
): Promise<string> {
  const expiresAt = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ exp: expiresAt })),
  );
  const signature = await sign(payload, signingSecret(env));
  const value = `${payload}.${signature}`;
  return `${COOKIE_NAME}=${value}; ${cookieAttributes(
    request,
    SESSION_DAYS * 86_400,
  )}`;
}

export function clearSessionCookie(request: Request): string {
  return `${COOKIE_NAME}=; ${cookieAttributes(request, 0)}`;
}

async function sessionIsValid(request: Request, env: Env): Promise<boolean> {
  const raw = readCookie(request, COOKIE_NAME);
  if (!raw) return false;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  const expected = await sign(payload, signingSecret(env));
  if (!timingSafeEqual(signature, expected)) return false;

  try {
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return typeof decoded.exp === "number" && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- policy */

export type AuthMode = "required" | "disabled" | "misconfigured";

/**
 * Fail closed. Auth is only skipped when `.dev.vars` marks the run as local
 * development — that file is never deployed, so a deployed Worker without a
 * password serves errors rather than open data.
 */
export function authMode(env: Env): AuthMode {
  const isLocalDev = env.LEDGERLY_DEV === "true";
  if (env.LEDGERLY_PASSWORD) return "required";
  return isLocalDev ? "disabled" : "misconfigured";
}

export async function isAuthenticated(
  request: Request,
  env: Env,
): Promise<boolean> {
  if (authMode(env) === "disabled") return true;
  return sessionIsValid(request, env);
}

/** Constant-ish work on failure to blunt trivial password guessing. */
export async function verifyPassword(
  env: Env,
  candidate: unknown,
): Promise<boolean> {
  const expected = env.LEDGERLY_PASSWORD;
  if (!expected || typeof candidate !== "string") return false;
  const ok = timingSafeEqual(candidate, expected);
  if (!ok) await new Promise((resolve) => setTimeout(resolve, 250));
  return ok;
}
