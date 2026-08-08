import type { DocumentRow, DocumentStatus } from "../shared/types";
import { MAX_FILE_BYTES } from "../shared/types";
import type { Env } from "./db";
import { safeSegment, uuid } from "./util";

const STATUSES: DocumentStatus[] = ["queued", "stored", "review"];

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === "string" && STATUSES.includes(value as DocumentStatus);
}

/**
 * Files we cannot ground an extraction from land in `review` so the user keys
 * the transaction in themselves. We never invent values from a scan.
 */
export function defaultStatusFor(mimeType: string, filename: string): DocumentStatus {
  const name = filename.toLowerCase();
  const isTabular =
    mimeType.includes("csv") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    name.endsWith(".csv") ||
    name.endsWith(".tsv") ||
    name.endsWith(".xlsx");
  return isTabular ? "stored" : "review";
}

export interface StoreFileArgs {
  bytes: ArrayBuffer | Uint8Array;
  filename: string;
  mimeType: string;
  source: "upload" | "google-drive";
  status: DocumentStatus;
  /** Google Drive file id, stored as object metadata only. */
  driveFileId?: string;
  driveModifiedTime?: string;
}

export async function storeDocument(
  env: Env,
  args: StoreFileArgs,
): Promise<{ ok: true; row: DocumentRow } | { ok: false; error: string }> {
  const body =
    args.bytes instanceof Uint8Array
      ? args.bytes
      : new Uint8Array(args.bytes as ArrayBuffer);

  if (body.byteLength === 0) {
    return { ok: false, error: `${args.filename} is empty.` };
  }
  if (body.byteLength > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `${args.filename} is ${(body.byteLength / 1024 / 1024).toFixed(
        1,
      )} MB. The limit is 20 MB per file.`,
    };
  }

  const id = uuid();
  const safeName = safeSegment(args.filename, "file");
  const objectKey =
    args.source === "google-drive"
      ? `drive-inbox/${safeSegment(args.driveFileId ?? id, id)}-${safeName}`
      : `uploads/${id}-${safeName}`;

  const customMetadata: Record<string, string> = { documentId: id };
  if (args.driveFileId) customMetadata.driveFileId = args.driveFileId;
  if (args.driveModifiedTime)
    customMetadata.driveModifiedTime = args.driveModifiedTime;

  await env.BUCKET.put(objectKey, body, {
    httpMetadata: { contentType: args.mimeType || "application/octet-stream" },
    customMetadata,
  });

  const row: DocumentRow & { objectKey: string } = {
    id,
    filename: args.filename.slice(0, 200),
    mimeType: args.mimeType || "application/octet-stream",
    size: body.byteLength,
    objectKey,
    status: args.status,
    source: args.source,
    createdAt: new Date().toISOString(),
  };

  try {
    await env.DB.prepare(
      `INSERT INTO documents (id, filename, mimeType, size, objectKey, status, source, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.id,
        row.filename,
        row.mimeType,
        row.size,
        row.objectKey,
        row.status,
        row.source,
        row.createdAt,
      )
      .run();
  } catch (err) {
    // Keep R2 and D1 consistent: an orphaned object would never be reachable.
    await env.BUCKET.delete(objectKey).catch(() => {});
    throw err;
  }

  const { objectKey: _hidden, ...safeRow } = row;
  return { ok: true, row: safeRow };
}

export async function listDocuments(
  env: Env,
  limit = 100,
): Promise<DocumentRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, filename, mimeType, size, status, source, createdAt
       FROM documents ORDER BY createdAt DESC LIMIT ?`,
  )
    .bind(limit)
    .all<DocumentRow>();
  return results ?? [];
}

export async function deleteDocument(
  env: Env,
  id: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT objectKey FROM documents WHERE id = ?`,
  )
    .bind(id)
    .first<{ objectKey: string }>();
  if (!row) return false;

  await env.BUCKET.delete(row.objectKey);
  await env.DB.prepare(`DELETE FROM documents WHERE id = ?`).bind(id).run();
  return true;
}

/** Deletes every object this Site owns. Used by the full-wipe endpoint. */
export async function deleteAllObjects(env: Env): Promise<number> {
  let deleted = 0;
  for (const prefix of ["uploads/", "drive-inbox/"]) {
    let cursor: string | undefined;
    do {
      const listing = await env.BUCKET.list({ prefix, cursor, limit: 500 });
      const keys = listing.objects.map((o) => o.key);
      if (keys.length) {
        await env.BUCKET.delete(keys);
        deleted += keys.length;
      }
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);
  }
  return deleted;
}
