import type { DriveSyncMeta } from "../shared/types";
import { MAX_FILE_BYTES } from "../shared/types";
import { readSettings, writeSettings, type Env } from "./db";
import { isDocumentStatus, storeDocument } from "./documents";
import { insertTransactions } from "./transactions";
import { normalizeDate, timingSafeEqual } from "./util";

const MAX_PROCESSED_IDS = 5000;
const DRIVE_TAG = "Drive import";
const DRIVE_ACCOUNT = "Drive import";

export const tokensMatch = timingSafeEqual;

export function authorizeDriveSync(
  request: Request,
  env: Env,
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = env.DRIVE_SYNC_TOKEN;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error:
        "Drive sync is not configured. Set the DRIVE_SYNC_TOKEN secret before running the automation.",
    };
  }
  const header =
    request.headers.get("OAI-Sites-Authorization") ??
    request.headers.get("Authorization") ??
    "";
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  if (!provided || !tokensMatch(provided, expected)) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  return { ok: true };
}

export interface DriveFilePayload {
  id?: string;
  filename?: string;
  mimeType?: string;
  modifiedTime?: string;
  contentBase64?: string;
  status?: string;
}

export interface DriveSyncPayload {
  transactions?: unknown[];
  files?: DriveFilePayload[];
  errors?: unknown[];
}

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/^data:[^;]*;base64,/, "").replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A file modified at or before the last wipe must never be re-imported. */
export function isBeforeReset(
  modifiedTime: string | undefined,
  resetAt: string | null,
): boolean {
  if (!resetAt || !modifiedTime) return false;
  const modified = Date.parse(modifiedTime);
  const reset = Date.parse(resetAt);
  if (Number.isNaN(modified) || Number.isNaN(reset)) return false;
  return modified <= reset;
}

export async function handleDriveSyncPost(
  env: Env,
  payload: DriveSyncPayload,
): Promise<Response> {
  const settings = await readSettings(env);
  const resetAt = (settings.driveResetAt as string | null) ?? null;
  const processed = new Set(
    Array.isArray(settings.processedFileIds)
      ? (settings.processedFileIds as string[])
      : [],
  );

  const errors: string[] = [];
  for (const err of Array.isArray(payload.errors) ? payload.errors : []) {
    if (typeof err === "string" && err.trim()) errors.push(err.trim().slice(0, 300));
  }

  /* ---- files: store original bytes, then remember the id as processed ---- */

  let filesStored = 0;
  let review = 0;
  const newlyProcessed: string[] = [];
  const fileFailed = new Set<string>();
  /** Files the wipe guard excluded — their transactions must be dropped too. */
  const skippedByReset = new Set<string>();

  for (const file of Array.isArray(payload.files) ? payload.files : []) {
    const driveId = typeof file.id === "string" ? file.id.trim() : "";
    if (!driveId) {
      errors.push("A Drive file was sent without an id and was skipped.");
      continue;
    }
    if (processed.has(driveId)) continue;
    if (isBeforeReset(file.modifiedTime, resetAt)) {
      skippedByReset.add(driveId);
      continue;
    }

    const filename =
      typeof file.filename === "string" && file.filename.trim()
        ? file.filename.trim()
        : `drive-file-${driveId}`;
    const status = isDocumentStatus(file.status) ? file.status : "review";

    if (!file.contentBase64) {
      // Nothing durable to store yet — leave it unprocessed so tomorrow retries.
      fileFailed.add(driveId);
      errors.push(`${filename}: original bytes were not transferred.`);
      continue;
    }

    try {
      const bytes = decodeBase64(file.contentBase64);
      if (bytes.byteLength > MAX_FILE_BYTES) {
        fileFailed.add(driveId);
        errors.push(`${filename}: larger than the 20 MB limit.`);
        continue;
      }
      const stored = await storeDocument(env, {
        bytes,
        filename,
        mimeType: file.mimeType || "application/octet-stream",
        source: "google-drive",
        status,
        driveFileId: driveId,
        driveModifiedTime: file.modifiedTime,
      });
      if (!stored.ok) {
        fileFailed.add(driveId);
        errors.push(stored.error);
        continue;
      }
      filesStored += 1;
      if (status === "review") review += 1;
      newlyProcessed.push(driveId);
    } catch {
      fileFailed.add(driveId);
      errors.push(`${filename}: could not be stored. It will be retried.`);
    }
  }

  /* ------------------------------ transactions ------------------------------ */

  const inputs: Array<Record<string, unknown>> = [];
  for (const raw of Array.isArray(payload.transactions) ? payload.transactions : []) {
    if (!raw || typeof raw !== "object") continue;
    const tx = raw as Record<string, unknown>;
    const driveFileId =
      typeof tx.driveFileId === "string" ? tx.driveFileId.trim() : "";

    if (
      driveFileId &&
      (processed.has(driveFileId) ||
        fileFailed.has(driveFileId) ||
        skippedByReset.has(driveFileId))
    ) {
      continue;
    }
    if (isBeforeReset(tx.modifiedTime as string | undefined, resetAt)) continue;

    const tags = Array.isArray(tx.tags) ? [...(tx.tags as unknown[])] : [];
    tags.push(DRIVE_TAG);

    const account =
      typeof tx.account === "string" && tx.account.trim()
        ? tx.account.trim()
        : DRIVE_ACCOUNT;

    inputs.push({
      date: normalizeDate(tx.date),
      merchant: tx.merchant ?? tx.payee ?? tx.description,
      amount: tx.amount,
      type: tx.type,
      category: tx.category,
      account,
      tags,
      receipt: tx.receipt === true,
      source: "google-drive",
    });
  }

  const written = await insertTransactions(env, inputs, { applyRules: true });
  for (const err of written.errors.slice(0, 10)) errors.push(err);

  /* ------------------------------- bookkeeping ------------------------------ */

  const allProcessed = [...processed, ...newlyProcessed].slice(-MAX_PROCESSED_IDS);
  const status: "complete" | "partial" = errors.length ? "partial" : "complete";
  const lastSyncedAt = new Date().toISOString();

  const meta: DriveSyncMeta = {
    lastSyncedAt,
    status,
    imported: written.inserted,
    duplicates: written.duplicates,
    filesStored,
    review: review + written.needsReview,
    errors: errors.slice(0, 10),
  };

  await writeSettings(env, [
    ["processedFileIds", allProcessed],
    ["driveSync", meta],
    ...(written.inserted > 0 || filesStored > 0
      ? ([["freshStart", false]] as Array<[string, unknown]>)
      : []),
  ]);

  return new Response(
    JSON.stringify({
      status,
      lastSyncedAt,
      transactionsImported: written.inserted,
      duplicatesSkipped: written.duplicates,
      filesStored,
      filesNeedingReview: review,
      errors: meta.errors,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}
