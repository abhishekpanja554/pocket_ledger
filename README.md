# Pocket Ledger

A private personal finance dashboard. React + TypeScript front end, a Cloudflare
Worker API, **D1** (`DB`) for structured data and **R2** (`BUCKET`) for original
file bytes.

The browser is never the source of truth: every read comes from `GET /api/state`
and every edit is written to the server before the UI treats it as saved. Sign in
on another device, open the same deployment, and you see the same data.

**Currency: Indian rupees.** Amounts render as `₹1,57,500.00` with lakh/crore
grouping, chart axes compact to `₹1.5L` / `₹1.2Cr`, and dates read `5 Jul 2026`.
To change currency, edit `LOCALE` and `CURRENCY` at the top of
[`src/lib/format.ts`](src/lib/format.ts) — every amount in the app goes through
that one module.

---

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` runs Vite together with the Worker, backed by a **local** D1
database and R2 bucket under `.wrangler/`. No Cloudflare account is needed to
develop.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-checks, then builds the client and the Worker |
| `npm run typecheck` | Type-checks only |
| `npm run deploy` | Builds and deploys to Cloudflare |
| `npm run db:local` / `db:remote` | Applies `schema.sql` explicitly (the Worker also self-heals the schema on every API request) |
| `npm run verify` | End-to-end smoke test against a running server. **Wipes all data** — dev only. |

### Local secrets

`.dev.vars` (git-ignored) holds development values:

```
DRIVE_SYNC_TOKEN=<random hex>
LEDGERLY_TIMEZONE=America/New_York
```

`DRIVE_SYNC_TOKEN` is the bearer the Drive automation presents. Without it,
`/api/drive-sync` returns 503 and refuses to run — it never falls back to an
open endpoint.

---

## Deploying to workers.dev

Every Cloudflare account gets a free `workers.dev` subdomain, so this needs no
domain purchase. The app lands at
`ledgerly.<your-subdomain>.workers.dev` with HTTPS on the free plan.

```bash
npx wrangler login
npx wrangler d1 create ledgerly-db          # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create ledgerly-files
npx wrangler secret put LEDGERLY_PASSWORD   # your sign-in passphrase
npx wrangler secret put SESSION_SECRET      # e.g. `openssl rand -hex 32`
npx wrangler secret put DRIVE_SYNC_TOKEN    # e.g. `openssl rand -hex 24`
npm run deploy
```

R2 generally wants a payment method on file even inside its free allowance.

### Why not Cloudflare Access

Access self-hosted applications require a domain that is an active zone in your
Cloudflare account; the "Enable Cloudflare Access" toggle in the Workers
dashboard covers **Preview URLs**, not the production `workers.dev` route. So
this app carries its own owner login instead — see below. If you later add a
domain, Access is still the stronger option and can sit in front of all of this.

## Owner authentication

`LEDGERLY_PASSWORD` is compared server-side; a match issues an HMAC-signed,
HttpOnly, SameSite=Lax session cookie valid for 30 days. `SESSION_SECRET` signs
it (if unset, the signing key is derived from the password, so rotating the
password invalidates existing sessions).

What is gated: **every `/api/*` route**. The HTML and JS bundle are not gated
because they contain no data — everything sensitive is fetched through the API.

Two exemptions, both deliberate:

- `/api/auth/*` — that is how you sign in.
- `/api/drive-sync` — the automation has no browser session and authenticates
  with its own `DRIVE_SYNC_TOKEN` bearer instead.

**It fails closed.** A deployed Worker with no `LEDGERLY_PASSWORD` serves `503`
on every API route with an actionable message rather than serving your data.
Auth is only relaxed when `LEDGERLY_DEV=true`, which lives in `.dev.vars` and is
never deployed — so `npm run dev` stays frictionless locally.

Honest limits: there is no rate limiting beyond a fixed delay on a failed
attempt (a Worker has no shared state for counters without KV or Durable
Objects), and there is one shared passphrase rather than real user identity.
Choose a long passphrase.

---

## Data model

`schema.sql` (mirrored in `worker/db.ts`, applied idempotently on every request):

- **transactions** — `amount` is always a positive magnitude; `type` carries the
  direction. `fingerprint` is `UNIQUE`.
- **tags** — name only.
- **rules** — plain-language `whenText` / `thenText` with an enabled flag.
- **settings** — key/value JSON: categories, accounts, goals, budgets,
  subscriptions, recurring, dismissed patterns, assets, liabilities,
  `netWorthConfigured`, `selectedPeriod`, Drive folder/schedule/sync metadata,
  `processedFileIds`, `driveResetAt`, `freshStart`.
- **documents** — file metadata; the R2 `objectKey` is stored but never sent to
  the browser.

On a fresh database every financial dataset is empty. Category and account
*names* are seeded because they are lookup configuration — they carry no
balances and create no transactions. Both lists are editable in Settings.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/auth/status` | Whether auth is required, configured, and satisfied. |
| `POST /api/auth/login` | `{ password }` → sets the session cookie. |
| `POST /api/auth/logout` | Clears it. |
| `GET /api/state` | One normalized payload: ≤5,000 transactions, tags, rules, decoded settings, ≤100 document rows. Never file bytes. |
| `POST /api/transactions` | One transaction or a batch. Returns `inserted` / `duplicates` / `skipped` / `needsReview`. |
| `PATCH /api/transactions/:id` | Category and/or tags. |
| `DELETE /api/transactions/:id` | Remove one transaction. |
| `PUT /api/preferences` | Partial update — only keys present in the body are written, so one group never resets another. |
| `POST /api/documents` | Multipart upload, 20 MB per file, bytes to R2 and metadata to D1. |
| — | Ambiguous numeric dates sent to the API are read **day-first** (`05/07/2026` = 5 July). |
| `GET /api/documents/:id/file` | Owner download; object keys stay server-side. |
| `DELETE /api/documents/:id` | Removes the R2 object and the D1 row. |
| `DELETE /api/state` | Full wipe. Requires `{"confirm":"DELETE ALL LEDGERLY DATA"}`. |
| `GET`/`POST /api/drive-sync` | Protected Drive bridge (bearer token). |
| `GET /api/health` | D1 and R2 reachability. |

### Importing statements

The importer accepts **CSV/TSV** and **Excel `.xlsx`/`.xlsm`**. Spreadsheets are
read by `src/lib/xlsx.ts` with no third-party dependency — the browser's
`DecompressionStream` unzips the parts and `DOMParser` reads the XML. Date cells
are resolved through `styles.xml` and emitted as ISO `YYYY-MM-DD`, so day-first
ambiguity does not arise for spreadsheets at all.

It also copes with how banks really export:

- **Preamble rows.** `findHeaderRow` scores the first 15 rows and picks the one
  that actually names a date, a description and a money column, so account
  details and blank lines above the header are skipped (and reported).
- **Multiple sheets.** Sheets with data are offered in a picker.
- **Mislabelled files.** A `.xls` that is really an HTML table or delimited text
  is detected by content and parsed anyway. A genuine legacy BIFF `.xls` gets a
  clear "re-save as .xlsx or CSV" message rather than a silent failure.
- **Balance columns** are never mistaken for transaction amounts.

### Duplicate detection

Every path — manual entry, CSV, documents, Drive — builds the same fingerprint:

```
date + "|" + merchant.trim().toLowerCase() + "|" + amount.toFixed(2) + "|" + account.trim().toLowerCase()
```

The batch is de-duplicated in memory, checked against D1, and finally inserted
with `ON CONFLICT(fingerprint) DO NOTHING`. The UNIQUE constraint is what makes
two simultaneous imports safe; the pre-check only makes the reported counts
accurate. Categorization rules run **after** de-duplication, so a rule can never
cause a duplicate row.

### Recurring and subscription detection

`src/lib/recurring.ts`, over saved **expenses** only:

1. Normalize the merchant for matching (lowercase, strip punctuation, a trailing
   `#1234`, and long reference digits). The transaction keeps its display name.
2. Group by normalized merchant; require ≥2 unique dates.
3. Classify the dominant interval: weekly 5–9d, biweekly 12–17d, monthly 24–40d,
   quarterly 75–110d, annual 330–400d. Anything else is rejected.
4. Amount variation limits: 20% for a subscription candidate, 35% for another
   recurring candidate.
5. With no recognizable service or bill hint, a merchant needs ≥3 monthly/
   quarterly/annual occurrences with ≤3% variation — so repeat grocery runs are
   never suggested.
6. **High confidence** = ≥3 occurrences, ≤12% variation, ≤5 days of interval
   jitter. Otherwise **Likely**.
7. Next date is calendar-aware (day-of-month preserved, clamped at month end).
   Monthly equivalents: weekly ×52/12, biweekly ×26/12, monthly ×1,
   quarterly ÷3, annual ÷12.

Detection only ever *suggests*. Keep confirms; Ignore stores a dismissal key that
persists across devices and is reversible from Settings.

---

## Google Drive inbox

The app never touches Google Drive from browser code. A scheduled automation is
the bridge: it reads the dedicated folder with your authorization and posts to
`/api/drive-sync` with an `OAI-Sites-Authorization: Bearer <token>` header.

**`GET /api/drive-sync`** returns folder metadata, `{ time: "08:00", timezone,
cadence: "daily" }`, last sync status and counts, up to the 5,000 most recent
`processedFileIds`, and `resetAt`.

**`POST /api/drive-sync`** accepts:

```jsonc
{
  "transactions": [
    { "driveFileId": "…", "date": "2026-07-04", "merchant": "…",
      "amount": 33.25, "type": "expense", "category": "…", "receipt": true }
  ],
  "files": [
    { "id": "…", "filename": "…", "mimeType": "…",
      "modifiedTime": "2026-07-04T09:12:00Z", "contentBase64": "…",
      "status": "stored" }
  ],
  "errors": ["concise, non-sensitive"]
}
```

The endpoint owns durable storage and de-duplication. It tags Drive transactions
`Drive import`, defaults their account to `Drive import` when none is grounded,
stores bytes at `drive-inbox/<safe-id>-<safe-name>`, and marks a Drive file ID
processed **only after** its data is stored — a failed transfer is left
unprocessed so the next run retries it.

After a wipe, `driveResetAt` is set to that moment and any Drive file modified at
or before it is ignored forever, so old inbox files cannot repopulate the app.

The automation must obtain its bearer at run time and never write it into source,
the database, a Drive file, a notification, or a log.

---

## The live Drive automation

The brief targeted a ChatGPT Work automation. The equivalent here is a local
scheduled task, and it is configured and running:

| | |
| --- | --- |
| Drive folder | **Ledgerly Financial Inbox** — `1egogDqcK1piOKf9OyfSiuHjHHB4kme5H` |
| Folder link | https://drive.google.com/drive/folders/1egogDqcK1piOKf9OyfSiuHjHHB4kme5H |
| Schedule | `0 8 * * *` — daily at 08:00 **Asia/Kolkata** (the runtime adds a few minutes of jitter) |
| Task file | `~/.claude/scheduled-tasks/sync-ledgerly-inbox/SKILL.md` |

The task reads `DRIVE_SYNC_TOKEN` from `.dev.vars` at run time — the token is not
written into the task, this repository, D1, R2, or any notification. It lists
only the direct children of that one folder, never modifies Drive, skips file IDs
already in `processedFileIds` and anything modified at or before `driveResetAt`,
and reports counts only.

**It posts to `http://localhost:5173`, so the app has to be running for a sync to
succeed.** If it is not, the task reports that it skipped the run and marks
nothing as processed, so the next run picks the files up.

After deploying, edit the base URL at the top of that `SKILL.md` to the
`workers.dev` hostname. Nothing else changes: the automation authenticates with
`DRIVE_SYNC_TOKEN`, which is exempt from the owner login, and it keeps running
on your Mac because reading your Drive needs your Google authorization — a
Cloudflare Cron Trigger could not do it.

## What is not built here

- **No published ChatGPT Site.** This is a deployable Cloudflare Worker instead,
  using the same D1/R2 bindings the brief specified; `.openai/hosting.json`
  records the logical binding names.
- **Not deployed yet.** `wrangler` is not authenticated on this machine. Follow
  *Deploying to workers.dev* above — the auth layer is built, tested and waiting.
