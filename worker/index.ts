import { Hono } from "hono";
import {
  MAX_FILE_BYTES,
  WIPE_CONFIRMATION,
  type AppState,
} from "../shared/types";
import {
  authMode,
  clearSessionCookie,
  createSessionCookie,
  isAuthenticated,
  verifyPassword,
} from "./auth";
import {
  decodeSettings,
  ensureSchema,
  ensureStructuralSettings,
  listTransactions,
  readSettings,
  writeSettings,
  type Env,
} from "./db";
import {
  defaultStatusFor,
  deleteAllObjects,
  deleteDocument,
  isDocumentStatus,
  listDocuments,
  storeDocument,
} from "./documents";
import {
  authorizeDriveSync,
  handleDriveSyncPost,
  type DriveSyncPayload,
} from "./drive-sync";
import {
  collectSettingUpdates,
  normalizeRules,
  replaceRules,
  replaceTags,
  stripTagsFromTransactions,
} from "./preferences";
import {
  getTransaction,
  insertTransactions,
  registerTags,
} from "./transactions";
import {
  errorResponse,
  fingerprintOf,
  json,
  normalizeTags,
  validateTransaction,
} from "./util";

const app = new Hono<{ Bindings: Env }>();

/**
 * Owner gate. Runs before anything touches the database.
 *
 * `/api/auth/*` is exempt (that is how you log in) and `/api/drive-sync` is
 * exempt because it carries its own bearer token — the automation has no
 * browser session.
 */
app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/auth/") || path === "/api/drive-sync") {
    return next();
  }

  const mode = authMode(c.env);
  if (mode === "misconfigured") {
    return errorResponse(
      "This Pocket Ledger deployment has no owner passphrase set. Run: wrangler secret put LEDGERLY_PASSWORD",
      503,
    );
  }
  if (!(await isAuthenticated(c.req.raw, c.env))) {
    return errorResponse("Sign in to continue.", 401);
  }
  return next();
});

/** Every API request self-heals the schema, so deploys never need a migration step. */
app.use("/api/*", async (c, next) => {
  try {
    await ensureSchema(c.env);
  } catch {
    return errorResponse(
      "The Pocket Ledger database is unavailable. Nothing was saved.",
      503,
    );
  }
  return next();
});

app.onError((err, c) => {
  // Deliberately terse: never log payloads, filenames or account details.
  console.error("ledgerly:", c.req.method, new URL(c.req.url).pathname, err.name);
  return errorResponse("Something went wrong on the server. Nothing was saved.", 500);
});

/* --------------------------------------------------------------------- auth */

app.get("/api/auth/status", async (c) => {
  const mode = authMode(c.env);
  return json({
    required: mode === "required",
    misconfigured: mode === "misconfigured",
    authenticated: await isAuthenticated(c.req.raw, c.env),
  });
});

app.post("/api/auth/login", async (c) => {
  if (authMode(c.env) === "misconfigured") {
    return errorResponse(
      "This Pocket Ledger deployment has no owner passphrase set.",
      503,
    );
  }

  let body: { password?: unknown };
  try {
    body = (await c.req.json()) as { password?: unknown };
  } catch {
    return errorResponse("Expected a JSON body.");
  }

  if (!(await verifyPassword(c.env, body.password))) {
    return errorResponse("That passphrase is not correct.", 401);
  }

  const cookie = await createSessionCookie(c.req.raw, c.env);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": cookie,
    },
  });
});

app.post("/api/auth/logout", (c) => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": clearSessionCookie(c.req.raw),
    },
  });
});

/* -------------------------------------------------------------------- state */

app.get("/api/state", async (c) => {
  const [transactions, tagRows, ruleRows, rawSettings, documents] =
    await Promise.all([
      listTransactions(c.env, 5000),
      c.env.DB.prepare(`SELECT name, createdAt FROM tags ORDER BY name ASC`).all<{
        name: string;
        createdAt: string;
      }>(),
      c.env.DB.prepare(`SELECT * FROM rules ORDER BY createdAt ASC`).all<{
        id: string;
        whenText: string;
        thenText: string;
        enabled: number;
        createdAt: string;
      }>(),
      readSettings(c.env),
      listDocuments(c.env, 100),
    ]);

  const state: AppState = {
    transactions,
    tags: tagRows.results ?? [],
    rules: (ruleRows.results ?? []).map((r) => ({ ...r, enabled: r.enabled === 1 })),
    settings: decodeSettings(rawSettings, c.env),
    documents,
  };

  return json(state);
});

/** Full wipe. Requires the exact server confirmation phrase. */
app.delete("/api/state", async (c) => {
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (body.confirm !== WIPE_CONFIRMATION) {
    return errorResponse(
      `This request must include the exact confirmation value.`,
      400,
    );
  }

  // The dedicated Drive folder and its schedule are configuration, not
  // financial data. A wipe must not make the app forget which folder is yours —
  // the daily automation stays configured and keeps pointing at it.
  const before = await readSettings(c.env);
  const preserved: Array<[string, unknown]> = [];
  if (before.driveFolder) preserved.push(["driveFolder", before.driveFolder]);
  if (before.driveSchedule) preserved.push(["driveSchedule", before.driveSchedule]);

  const objectsDeleted = await deleteAllObjects(c.env);

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM transactions`),
    c.env.DB.prepare(`DELETE FROM documents`),
    c.env.DB.prepare(`DELETE FROM rules`),
    c.env.DB.prepare(`DELETE FROM tags`),
    c.env.DB.prepare(`DELETE FROM settings`),
  ]);

  // Recreate structural settings only — no financial values of any kind.
  await ensureStructuralSettings(c.env);
  await writeSettings(c.env, [
    ["assets", 0],
    ["liabilities", 0],
    ["netWorthConfigured", false],
    ["selectedPeriod", "all-time"],
    ["freshStart", true],
    ["driveResetAt", new Date().toISOString()],
    ["processedFileIds", []],
    [
      "driveSync",
      {
        lastSyncedAt: null,
        status: "never",
        imported: 0,
        duplicates: 0,
        filesStored: 0,
        review: 0,
        errors: [],
      },
    ],
    ...preserved,
  ]);

  const settings = decodeSettings(await readSettings(c.env), c.env);

  return json({
    ok: true,
    message: "All Pocket Ledger data was deleted.",
    objectsDeleted,
    driveResetAt: settings.driveResetAt,
    settings,
  });
});

/* ------------------------------------------------------------- transactions */

app.post("/api/transactions", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse("Expected a JSON body.");
  }

  const container = body as Record<string, unknown>;
  const list = Array.isArray(body)
    ? body
    : Array.isArray(container?.transactions)
      ? (container.transactions as unknown[])
      : [body];

  if (list.length === 0) return errorResponse("No transactions were supplied.");
  if (list.length > 2000) {
    return errorResponse("Import batches are limited to 2,000 rows at a time.");
  }

  const applyRulesFlag =
    container?.applyRules === true ||
    (typeof container?.source === "string" && container.source !== "manual");

  const result = await insertTransactions(c.env, list, {
    applyRules: applyRulesFlag,
  });

  if (result.inserted === 0 && result.rows.length === 0 && result.skipped === list.length) {
    return json(result, 400);
  }
  if (result.inserted > 0) await writeSettings(c.env, [["freshStart", false]]);

  return json(result, 200);
});

app.patch("/api/transactions/:id", async (c) => {
  const id = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("Expected a JSON body.");
  }

  const current = await getTransaction(c.env, id);
  if (!current) return errorResponse("That transaction no longer exists.", 404);

  // Every field is optional: only what the request sends is changed, so the
  // inline category/tag editors and the full edit form share one endpoint.
  const has = (key: string) =>
    Object.prototype.hasOwnProperty.call(body, key);

  const merged = {
    date: has("date") ? body.date : current.date,
    merchant: has("merchant") ? body.merchant : current.merchant,
    amount: has("amount") ? body.amount : current.amount,
    type: has("type") ? body.type : current.type,
    category: has("category") ? body.category : current.category,
    account: has("account") ? body.account : current.account,
    tags: has("tags") ? body.tags : current.tags,
    receipt: has("receipt") ? body.receipt === true : current.receipt,
    // Provenance is not editable: an imported row stays marked as imported.
    source: current.source,
  };

  const validated = validateTransaction(merged);
  if (!validated.ok) return errorResponse(validated.error, 400);
  const value = validated.value;

  // date / merchant / amount / account feed the duplicate fingerprint, so an
  // edit can collide with an existing row. Report that instead of letting the
  // UNIQUE constraint surface as a generic failure.
  const fingerprint = fingerprintOf(value);
  if (fingerprint !== current.fingerprint) {
    const clash = await c.env.DB.prepare(
      `SELECT id FROM transactions WHERE fingerprint = ? AND id != ?`,
    )
      .bind(fingerprint, id)
      .first<{ id: string }>();
    if (clash) {
      return errorResponse(
        "Another transaction already has that date, merchant, amount and account.",
        409,
      );
    }
  }

  await c.env.DB.prepare(
    `UPDATE transactions
        SET date = ?, merchant = ?, category = ?, amount = ?, type = ?,
            account = ?, tags = ?, receipt = ?, fingerprint = ?
      WHERE id = ?`,
  )
    .bind(
      value.date,
      value.merchant,
      value.category,
      value.amount,
      value.type,
      value.account,
      JSON.stringify(value.tags),
      value.receipt ? 1 : 0,
      fingerprint,
      id,
    )
    .run();

  await registerTags(c.env, value.tags);

  const saved = await getTransaction(c.env, id);
  return json({ ok: true, transaction: saved });
});

app.delete("/api/transactions/:id", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB.prepare(`DELETE FROM transactions WHERE id = ?`)
    .bind(id)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    return errorResponse("That transaction no longer exists.", 404);
  }
  return json({ ok: true, id });
});

/* -------------------------------------------------------------- preferences */

app.put("/api/preferences", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("Expected a JSON body.");
  }
  if (!body || typeof body !== "object") {
    return errorResponse("Expected a JSON object.");
  }

  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  // Tags and rules live in their own tables; everything else is a settings row.
  if (has("tags")) await replaceTags(c.env, normalizeTags(body.tags));
  if (has("stripTagsFromTransactions")) {
    await stripTagsFromTransactions(
      c.env,
      normalizeTags(body.stripTagsFromTransactions),
    );
  }
  if (has("rules")) await replaceRules(c.env, normalizeRules(body.rules));

  const updates = collectSettingUpdates(body);
  if (updates.length) await writeSettings(c.env, updates);

  const settings = decodeSettings(await readSettings(c.env), c.env);
  const tagRows = await c.env.DB.prepare(
    `SELECT name, createdAt FROM tags ORDER BY name ASC`,
  ).all<{ name: string; createdAt: string }>();
  const ruleRows = await c.env.DB.prepare(
    `SELECT * FROM rules ORDER BY createdAt ASC`,
  ).all<{
    id: string;
    whenText: string;
    thenText: string;
    enabled: number;
    createdAt: string;
  }>();

  return json({
    ok: true,
    settings,
    tags: tagRows.results ?? [],
    rules: (ruleRows.results ?? []).map((r) => ({ ...r, enabled: r.enabled === 1 })),
  });
});

/* ---------------------------------------------------------------- documents */

app.post("/api/documents", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return errorResponse("Expected a multipart upload.");
  }

  const files = [...form.getAll("files"), ...form.getAll("file")].filter(
    (entry): entry is File => entry instanceof File,
  );
  if (files.length === 0) return errorResponse("No files were supplied.");
  if (files.length > 20) {
    return errorResponse("Upload at most 20 files at a time.");
  }

  const requestedStatus = form.get("status");
  const stored: unknown[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      errors.push(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(
          1,
        )} MB. The limit is 20 MB per file.`,
      );
      continue;
    }
    try {
      const result = await storeDocument(c.env, {
        bytes: await file.arrayBuffer(),
        filename: file.name,
        mimeType: file.type,
        source: "upload",
        status: isDocumentStatus(requestedStatus)
          ? requestedStatus
          : defaultStatusFor(file.type, file.name),
      });
      if (result.ok) stored.push(result.row);
      else errors.push(result.error);
    } catch {
      errors.push(`${file.name} could not be stored. Nothing was saved for it.`);
    }
  }

  if (stored.length === 0) {
    return json({ stored: [], errors }, errors.length ? 400 : 200);
  }

  return json({ stored, errors, status: errors.length ? "partial" : "complete" });
});

/** Owner-only download. Raw object keys are never exposed to the client. */
app.get("/api/documents/:id/file", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT filename, mimeType, objectKey FROM documents WHERE id = ?`,
  )
    .bind(id)
    .first<{ filename: string; mimeType: string; objectKey: string }>();
  if (!row) return errorResponse("That document no longer exists.", 404);

  const object = await c.env.BUCKET.get(row.objectKey);
  if (!object) return errorResponse("The stored file is no longer available.", 404);

  return new Response(object.body, {
    headers: {
      "content-type": row.mimeType || "application/octet-stream",
      "content-disposition": `attachment; filename="${row.filename.replace(
        /"/g,
        "",
      )}"`,
      "cache-control": "no-store",
    },
  });
});

app.delete("/api/documents/:id", async (c) => {
  const ok = await deleteDocument(c.env, c.req.param("id"));
  if (!ok) return errorResponse("That document no longer exists.", 404);
  return json({ ok: true });
});

/* --------------------------------------------------------------- drive sync */

app.get("/api/drive-sync", async (c) => {
  const auth = authorizeDriveSync(c.req.raw, c.env);
  if (!auth.ok) return errorResponse(auth.error, auth.status);

  const raw = await readSettings(c.env);
  const settings = decodeSettings(raw, c.env);
  const processed = Array.isArray(raw.processedFileIds)
    ? (raw.processedFileIds as string[])
    : [];

  return json({
    folder: settings.driveFolder,
    schedule: settings.driveSchedule,
    lastSyncedAt: settings.driveSync.lastSyncedAt,
    status: settings.driveSync.status,
    imported: settings.driveSync.imported,
    duplicates: settings.driveSync.duplicates,
    filesStored: settings.driveSync.filesStored,
    review: settings.driveSync.review,
    errors: settings.driveSync.errors,
    processedFileIds: processed.slice(-5000),
    resetAt: settings.driveResetAt,
  });
});

app.post("/api/drive-sync", async (c) => {
  const auth = authorizeDriveSync(c.req.raw, c.env);
  if (!auth.ok) return errorResponse(auth.error, auth.status);

  let payload: DriveSyncPayload;
  try {
    payload = (await c.req.json()) as DriveSyncPayload;
  } catch {
    return errorResponse("Expected a JSON body.");
  }
  return handleDriveSyncPost(c.env, payload);
});

/* ------------------------------------------------------------------ health */

app.get("/api/health", async (c) => {
  const checks = { db: false, bucket: false };
  try {
    await c.env.DB.prepare(`SELECT 1`).first();
    checks.db = true;
  } catch {
    checks.db = false;
  }
  try {
    await c.env.BUCKET.list({ limit: 1 });
    checks.bucket = true;
  } catch {
    checks.bucket = false;
  }
  return json({
    ok: checks.db && checks.bucket,
    ...checks,
    driveSyncConfigured: Boolean(c.env.DRIVE_SYNC_TOKEN),
  });
});

app.all("/api/*", () => errorResponse("Unknown API route.", 404));

/** Everything else is the single-page app. */
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
