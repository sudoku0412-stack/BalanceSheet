# NestExpenseTracker

Personal + household expense tracker built around receipt scanning. Point
your phone at a receipt → on-device OCR + AI turns it into structured,
categorized spending you can search, chart, split with family, and export.

> **Repo note:** the GitHub repository may still be named `BalanceSheet`
> (legacy). The product name everywhere user-facing is **NestExpenseTracker**.
> Rename the GitHub repo under *Settings → General → Repository name* when
> you're ready; clone URLs below use the current remote.

Built with React Native (Expo) for Android and iOS, Firebase for auth +
cloud sync, and a Cloudflare Workers AI fallback so receipt parsing keeps
working even when the primary AI provider's free tier is exhausted.

## What it does

- **Scan a receipt** → on-device ML Kit OCR → Gemini 2.5 Flash (or
  Cloudflare Workers AI fallback) parses store name, date, line items,
  per-item categories, subtotal, tax, and total.
- **Dashboards & reports**: month-over-month spending, category
  breakdowns, recurring-purchase detection, top-stores list, PDF export.
- **Household sharing**: invite by email or phone, Splitwise-style
  splits (equal / percent / amount / shares), settle-up balances.
- **Offline-first**: SQLite is the source of truth; Firestore is a
  shadow-write for durability and multi-device sync.

## Quick start (development)

```bash
git clone https://github.com/sudoku0412-stack/BalanceSheet.git
cd BalanceSheet
npm install --legacy-peer-deps
npx expo prebuild --platform android   # or ios
npx expo start
```

You'll also need:

- `google-services.json` for Android Firebase (download from the
  Firebase console, place at repo root).
- `GoogleService-Info.plist` for iOS Firebase (same).
- `GEMINI_API_KEY` env var, OR a deployed Cloudflare Workers AI
  parser (see [`scripts/PARSE_WORKER_README.md`](scripts/PARSE_WORKER_README.md)).
- For household invite emails: `EMAILJS_SERVICE_ID`,
  `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY` — see
  [`scripts/PHASE3_EMAIL_INVITE_SETUP.md`](scripts/PHASE3_EMAIL_INVITE_SETUP.md).

## Architecture in 30 seconds

```
                     ┌────────────────────────────────────┐
                     │  React Native (Expo) app           │
                     │                                    │
                     │  ┌─────────────────────────────┐   │
                     │  │ ML Kit on-device OCR        │   │
                     │  │     ↓                       │   │
                     │  │ regex parser (lib/parser)   │   │
                     │  │     ↓ refined by            │   │
                     │  │ AI parse (Gemini → Worker)  │   │
                     │  └─────────────────────────────┘   │
                     │              ↓                     │
                     │  ┌─────────────────────────────┐   │
                     │  │ local SQLite (source of     │   │
                     │  │  truth for reads, offline)  │   │
                     │  └─────────────────────────────┘   │
                     │              ↕ shadow-write +      │
                     │                onSnapshot listener │
                     │  ┌─────────────────────────────┐   │
                     │  │ Firestore (cloud durability,│   │
                     │  │  multi-device sync, family) │   │
                     │  └─────────────────────────────┘   │
                     └────────────────────────────────────┘
```

**Why local-first**: the dashboard renders thousands of receipts fast
because every read is a SQLite query, not a network round-trip.

**Why a regex parser AND an AI parser**: the regex result shows
instantly while AI runs (1–4s). If AI fails, the regex result is
already on screen — graceful degradation.

## Receipt parsing in detail

1. **OCR** — on-device, no network.
2. **Regex parser** ([`lib/parser.ts`](lib/parser.ts)) — inline and
   two-column layouts, discounts, subtotal/tax/total heuristics.
3. **AI parser** ([`lib/geminiParseReceipt.ts`](lib/geminiParseReceipt.ts))
   — Gemini 2.5 Flash structured JSON.
4. **Worker fallback** ([`scripts/parse-receipt-worker.ts`](scripts/parse-receipt-worker.ts))
   — Cloudflare Workers AI when Gemini is rate-limited.
5. **Sanity check** ([`lib/itemsTotalCheck.ts`](lib/itemsTotalCheck.ts))
   — line-items sum vs printed subtotal before save.

## Multi-user & family sharing

- **Per-user isolation** in SQLite (`user_id`).
- **Cloud shadow-write** to `households/{hid}/receipts/{rid}`.
- **Household invites** (email via EmailJS, phone via share sheet) +
  contacts sync + live Firestore listeners.

Setup: [`scripts/PHASE2_FIRESTORE_RULES.md`](scripts/PHASE2_FIRESTORE_RULES.md),
[`scripts/PHASE3_EMAIL_INVITE_SETUP.md`](scripts/PHASE3_EMAIL_INVITE_SETUP.md).

## What's next

See [`PLAN.md`](PLAN.md) for release blockers and ordered next work, and
[`docs/INCOME_FEATURE.md`](docs/INCOME_FEATURE.md) for the proposed
**income vs spending** phase (cashflow dashboard, income categories,
recurring paychecks).

Older ops/planning notes: [`docs/V1.1_ROADMAP.md`](docs/V1.1_ROADMAP.md)
(feedback → Jira, admin web app).

## Build & ship

Pushes to `main` trigger [`.github/workflows/release-build.yml`](.github/workflows/release-build.yml)
(EAS cloud build + submit). Manual Android local builds:

```bash
gh workflow run android-build.yml --ref <branch> -f profile=production
```

OTA (JS/asset-only):

```bash
npx eas-cli update --branch preview --environment preview \
  --message "your change description"
```

## Tests

```bash
npm test           # full suite (unit / component / performance / regression)
npm test -- --watch
```

## Repo layout

```
app/              expo-router screens
components/       shared UI (receipt + ui primitives)
lib/              business logic (database, cloudSync, parser, …)
constants/        theme, categories
types/            Receipt, LineItem, Settlement, …
scripts/          Cloudflare workers, deploy guides
firebase-hosting/ legal/invite/support static pages (Cloudflare Pages)
plugins/          Expo config plugins
__tests__/        Jest tests
docs/             store listing, income roadmap, privacy sources
```

## License

Personal project — no license declared. Not for redistribution.
