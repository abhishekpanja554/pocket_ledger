# Pocket Ledger

A personal finance dashboard. React + TypeScript SPA, talking to a separate
[Spring Boot backend](https://github.com/abhishekpanja554/pocket_ledger_be)
over a REST API — this repo has no server logic or database of its own.

Live at [app.pocketledgerapp.com](https://app.pocketledgerapp.com).

> **A note on authorship:** the React frontend in this repo was built
> entirely by Claude (Anthropic), under my direction — I made that call
> deliberately so I could focus my own learning on the Spring Boot backend.
> The [backend repo](https://github.com/abhishekpanja554/pocket_ledger_be) is
> my own work: I wrote every line, with Claude reviewing and catching real
> bugs along the way.

The browser is never the source of truth: every read comes from
`GET /api/state` and every edit is written to the server before the UI
treats it as saved.

**Currency: Indian rupees.** Amounts render as `₹1,57,500.00` with
lakh/crore grouping, chart axes compact to `₹1.5L` / `₹1.2Cr`. To change
currency, edit `LOCALE` and `CURRENCY` at the top of
[`src/lib/format.ts`](src/lib/format.ts) — every amount in the app goes
through that one module.

---

## What it does

- Real per-user accounts: register, login, email verification, forgot/reset
  password.
- Transactions, budgets, goals, recurring/subscription detection, rules,
  and a documents vault, all rendered from one normalized app-state payload.
- CSV/TSV and Excel (`.xlsx`/`.xlsm`) statement import, parsed client-side
  ([`src/lib/csv.ts`](src/lib/csv.ts) / [`src/lib/xlsx.ts`](src/lib/xlsx.ts))
  before being sent to the backend for de-duplication and storage.
- Recurring and subscription detection
  ([`src/lib/recurring.ts`](src/lib/recurring.ts)) over saved expenses —
  merchant normalization, interval classification (weekly/biweekly/
  monthly/quarterly/annual), and amount-variation thresholds, entirely
  client-side against data already fetched from the backend.
- A Google Drive sync inbox with a manual "Sync now" trigger — the actual
  sync (Drive read, AI receipt extraction) runs on the backend; this repo
  just calls the trigger endpoint and renders the result.
- Light / Dark / System theme, persisted locally.

## Stack

React 18, TypeScript, Vite, plain CSS (custom-property based, no framework)
via [`src/styles.css`](src/styles.css), `lucide-react` for icons. No state
library beyond React context — see
[`src/store.tsx`](src/store.tsx).

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite dev server on port 5173 and expects a backend
at `http://localhost:8080` (see
[the backend repo](https://github.com/abhishekpanja554/pocket_ledger_be) to
run one locally) — `.env.development` already points there.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-checks, then builds a static production bundle to `dist/` |
| `npm run typecheck` | Type-checks only |

## Environment

`VITE_API_BASE_URL` is the only variable that matters — it's the backend
origin. `.env.production` and `.env.development` already set it for the
deployed backend and a local one respectively.

## Deploying

Deployed on Vercel as a plain static SPA (`vercel deploy --prod`), with a
`vercel.json` rewrite so hard refreshes on real (non-hash) routes like
`/verify-email` and `/reset-password` don't 404.

## Legacy leftovers

This app used to be a single-user Cloudflare Worker with its own D1
database and R2 bucket (`worker/`, `wrangler.jsonc`, the `hono` dependency).
None of that is used by the current build — the backend now lives entirely
in the separate Spring Boot repo — but it hasn't been deleted from this repo
yet.
