/**
 * End-to-end smoke test against a running Ledgerly server.
 *
 *   npm run verify                       # http://localhost:5173
 *   BASE=https://… npm run verify        # a deployment
 *
 * It finishes by wiping all data, so point it at a development database — never
 * at a deployment holding real records.
 */
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const WIPE = "DELETE ALL LEDGERLY DATA";

let token = process.env.DRIVE_SYNC_TOKEN ?? "";
if (!token) {
  try {
    token =
      readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(
        /^DRIVE_SYNC_TOKEN=(\S+)/m,
      )?.[1] ?? "";
  } catch {
    token = "";
  }
}

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function call(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

const authHeaders = { "OAI-Sites-Authorization": `Bearer ${token}` };

console.log(`\nVerifying ${BASE}\n`);

/* ---------------------------------------------------- empty-start contract */

console.log("== empty-start contract ==");
let state = (await call("/api/state")).body;
if (!state?.settings) {
  console.error(
    "Could not read /api/state. If this deployment requires a passphrase, run this against a dev server instead.",
  );
  process.exit(1);
}
check("transactions empty", state.transactions.length === 0);
check("documents empty", state.documents.length === 0);
check("tags empty", state.tags.length === 0);
check("rules empty", state.rules.length === 0);
check("goals empty", state.settings.goals.length === 0);
check("budgets empty", state.settings.budgets.length === 0);
check("subscriptions empty", state.settings.subscriptions.length === 0);
check("recurring empty", state.settings.recurring.length === 0);
check("selectedPeriod all-time", state.settings.selectedPeriod === "all-time");
check("net worth not configured", state.settings.netWorthConfigured === false);
check("starter categories present", state.settings.categories.includes("Housing"));
check("starter accounts present", state.settings.accounts.includes("Main Checking"));

/* -------------------------------------------------------------- write path */

console.log("\n== transactions ==");
const tx = {
  date: "2026-07-01",
  merchant: "Verify Merchant",
  amount: 12.5,
  type: "expense",
  category: "Dining",
  account: "Main Checking",
  tags: ["verify"],
  source: "manual",
};

let res = await call("/api/transactions", {
  method: "POST",
  body: JSON.stringify({ transactions: [tx] }),
});
check("insert one", res.body.inserted === 1, JSON.stringify(res.body));
const txId = res.body.rows?.[0]?.id;
check(
  "fingerprint shape",
  res.body.rows?.[0]?.fingerprint ===
    "2026-07-01|verify merchant|12.50|main checking",
  res.body.rows?.[0]?.fingerprint,
);

res = await call("/api/transactions", {
  method: "POST",
  body: JSON.stringify({ transactions: [tx] }),
});
check("duplicate skipped", res.body.inserted === 0 && res.body.duplicates === 1);

res = await call("/api/transactions", {
  method: "POST",
  body: JSON.stringify({ transactions: [{ ...tx, date: "not-a-date" }] }),
});
check("invalid date rejected", res.body.skipped === 1);

res = await call("/api/transactions", {
  method: "POST",
  body: JSON.stringify({
    transactions: [{ ...tx, date: "2026-07-02", amount: -5 }],
  }),
});
check("amount stored as magnitude", res.body.rows?.[0]?.amount === 5);

res = await call(`/api/transactions/${txId}`, {
  method: "PATCH",
  body: JSON.stringify({ category: "Groceries", tags: ["a", "A", " b "] }),
});
check("patch category", res.body.transaction?.category === "Groceries");
check(
  "tags normalized",
  JSON.stringify(res.body.transaction?.tags) === JSON.stringify(["a", "b"]),
  JSON.stringify(res.body.transaction?.tags),
);

state = (await call("/api/state")).body;
check(
  "patch persisted",
  state.transactions.find((t) => t.id === txId)?.category === "Groceries",
);

console.log("\n== editing a transaction ==");
res = await call(`/api/transactions/${txId}`, {
  method: "PATCH",
  body: JSON.stringify({
    date: "2026-07-11",
    merchant: "Renamed Merchant",
    amount: 77.5,
    type: "income",
    account: "Cash",
  }),
});
const edited = res.body.transaction;
check(
  "all fields updated",
  edited?.date === "2026-07-11" &&
    edited?.merchant === "Renamed Merchant" &&
    edited?.amount === 77.5 &&
    edited?.type === "income" &&
    edited?.account === "Cash",
  JSON.stringify(edited),
);
check(
  "fingerprint recomputed",
  edited?.fingerprint === "2026-07-11|renamed merchant|77.50|cash",
  edited?.fingerprint,
);
check("provenance preserved", edited?.source === "manual");

// A second row to collide with.
res = await call("/api/transactions", {
  method: "POST",
  body: JSON.stringify({
    transactions: [
      {
        date: "2026-07-12",
        merchant: "Collision Target",
        amount: 20,
        type: "expense",
        account: "Cash",
        source: "manual",
      },
    ],
  }),
});
const collisionId = res.body.rows?.[0]?.id;

res = await call(`/api/transactions/${txId}`, {
  method: "PATCH",
  body: JSON.stringify({
    date: "2026-07-12",
    merchant: "Collision Target",
    amount: 20,
    account: "Cash",
  }),
});
check("edit into a duplicate is refused", res.status === 409, String(res.status));

state = (await call("/api/state")).body;
check(
  "refused edit changed nothing",
  state.transactions.find((t) => t.id === txId)?.merchant === "Renamed Merchant",
);
check(
  "no duplicate row created",
  state.transactions.filter((t) => t.merchant === "Collision Target").length === 1,
);

res = await call(`/api/transactions/${txId}`, {
  method: "PATCH",
  body: JSON.stringify({ amount: 0 }),
});
check("edit validation enforced", res.status === 400);

await call(`/api/transactions/${collisionId}`, { method: "DELETE" });

/* ------------------------------------------------------------------- rules */

console.log("\n== rules apply to imports only ==");
await call("/api/preferences", {
  method: "PUT",
  body: JSON.stringify({
    rules: [
      {
        id: crypto.randomUUID(),
        whenText: "contains ruletest",
        thenText: "category: Utilities, tag: auto",
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ],
  }),
});
res = await call("/api/transactions", {
  method: "POST",
  body: JSON.stringify({
    transactions: [
      {
        date: "2026-07-03",
        merchant: "RuleTest Co",
        amount: 9,
        type: "expense",
        account: "Cash",
        source: "csv",
      },
    ],
    applyRules: true,
  }),
});
check("rule set category", res.body.rows?.[0]?.category === "Utilities");
check("rule added tag", res.body.rows?.[0]?.tags?.includes("auto") === true);

/* ------------------------------------------------------------- preferences */

console.log("\n== preferences isolation ==");
await call("/api/preferences", {
  method: "PUT",
  body: JSON.stringify({ assets: 1000, liabilities: 250, netWorthConfigured: true }),
});
res = await call("/api/preferences", {
  method: "PUT",
  body: JSON.stringify({ selectedPeriod: "this-month" }),
});
check(
  "unrelated settings preserved",
  res.body.settings.assets === 1000 && res.body.settings.netWorthConfigured === true,
);
check("period saved", res.body.settings.selectedPeriod === "this-month");
res = await call("/api/preferences", {
  method: "PUT",
  body: JSON.stringify({ selectedPeriod: "nonsense" }),
});
check("invalid period falls back", res.body.settings.selectedPeriod === "all-time");

/* --------------------------------------------------------------- documents */

console.log("\n== documents (R2 + D1) ==");
const form = new FormData();
form.append(
  "files",
  new File([new Uint8Array([1, 2, 3, 4, 5])], "verify.pdf", {
    type: "application/pdf",
  }),
);
res = await call("/api/documents", { method: "POST", body: form });
check("document stored", res.body.stored?.length === 1, JSON.stringify(res.body));
const docId = res.body.stored?.[0]?.id;
check("uncertain doc marked review", res.body.stored?.[0]?.status === "review");
check("objectKey not exposed", res.body.stored?.[0]?.objectKey === undefined);

const download = await fetch(`${BASE}/api/documents/${docId}/file`);
check(
  "download returns bytes",
  download.status === 200 && (await download.arrayBuffer()).byteLength === 5,
);

const big = new FormData();
big.append(
  "files",
  new File([new Uint8Array(21 * 1024 * 1024)], "big.pdf", {
    type: "application/pdf",
  }),
);
res = await call("/api/documents", { method: "POST", body: big });
check("over-20MB rejected", /20 MB/.test(JSON.stringify(res.body)));

/* -------------------------------------------------------------- drive sync */

console.log("\n== drive sync ==");
res = await call("/api/drive-sync");
check("unauthenticated GET rejected", res.status === 401);

if (token) {
  res = await call("/api/drive-sync", { headers: authHeaders });
  check("authorized GET works", res.status === 200 && res.body.schedule?.time === "08:00");

  const payload = {
    files: [
      {
        id: "verify-file-1",
        filename: "verify.csv",
        mimeType: "text/csv",
        modifiedTime: new Date().toISOString(),
        contentBase64: Buffer.from("a,b\n1,2\n").toString("base64"),
        status: "stored",
      },
    ],
    transactions: [
      {
        driveFileId: "verify-file-1",
        date: "2026-07-04",
        merchant: "Drive Verify Vendor",
        amount: 33.25,
        type: "expense",
      },
    ],
  };
  res = await call("/api/drive-sync", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(payload),
  });
  check("drive import", res.body.transactionsImported === 1 && res.body.filesStored === 1);
  res = await call("/api/drive-sync", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(payload),
  });
  check(
    "processed file not reimported",
    res.body.transactionsImported === 0 && res.body.filesStored === 0,
  );

  state = (await call("/api/state")).body;
  const driveTx = state.transactions.find((t) => t.merchant === "Drive Verify Vendor");
  check("drive tx tagged", driveTx?.tags.includes("Drive import") === true);
  check("drive tx source", driveTx?.source === "google-drive");
} else {
  console.log("  skip DRIVE_SYNC_TOKEN not available");
}

/* -------------------------------------------------------------------- wipe */

console.log("\n== full wipe ==");
res = await call("/api/state", {
  method: "DELETE",
  body: JSON.stringify({ confirm: "wrong" }),
});
check("wipe needs exact phrase", res.status === 400);

res = await call("/api/state", {
  method: "DELETE",
  body: JSON.stringify({ confirm: WIPE }),
});
check("wipe succeeded", res.body.ok === true);
check("driveResetAt set", typeof res.body.driveResetAt === "string");
check("net worth reset", res.body.settings.netWorthConfigured === false);
check("period reset", res.body.settings.selectedPeriod === "all-time");

state = (await call("/api/state")).body;
check("transactions cleared", state.transactions.length === 0);
check("documents cleared", state.documents.length === 0);
check("rules cleared", state.rules.length === 0);
check("tags cleared", state.tags.length === 0);
check("starter categories restored", state.settings.categories.includes("Housing"));

const gone = await fetch(`${BASE}/api/documents/${docId}/file`);
check("wiped document unreachable", gone.status === 404);

if (token) {
  res = await call("/api/drive-sync", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      files: [
        {
          id: "verify-old",
          filename: "old.csv",
          mimeType: "text/csv",
          modifiedTime: "2020-01-01T00:00:00Z",
          contentBase64: Buffer.from("x").toString("base64"),
        },
      ],
      transactions: [
        {
          driveFileId: "verify-old",
          date: "2020-01-01",
          merchant: "Old vendor",
          amount: 5,
          type: "expense",
        },
      ],
    }),
  });
  check(
    "pre-reset drive file ignored",
    res.body.filesStored === 0 && res.body.transactionsImported === 0,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log(`failed: ${failures.join(", ")}`);
process.exit(fail ? 1 : 0);
