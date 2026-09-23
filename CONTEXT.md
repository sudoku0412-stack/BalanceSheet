# Project Context

Read this first if you're a human or an AI picking up this codebase cold.
It explains what the app is, how it's built, and the non-obvious things
that will bite you if you don't know them. For day-to-day session state
(what happened last session, open threads), see [HANDOVER.md](HANDOVER.md)
instead — this file is the stable, slow-changing picture.

## What this app is

**NestExpenseTracker** — personal + household expense tracker built
around receipt scanning. Docs and user-facing strings use this name;
some package identifiers still say ReceiptScanner (see "Naming" below):

1. Point your phone camera at a receipt (or pick a photo from your library).
2. On-device ML Kit OCR pulls raw text off the image.
3. An AI parser (Gemini 2.5 Flash primary, Cloudflare Workers AI fallback)
   turns that raw text into a structured receipt: store name, date, line
   items with per-item categories, subtotal, tax, total.
4. You review/edit the result and save it.
5. Dashboards, category reports, recurring-purchase detection, and PDF
   export work off the saved data.
6. Optionally, split any receipt with other people in your **household**
   (Splitwise-style: equal / percent / dollar-amount / share-count), and
   see running balances of who owes whom.
7. Add household members by inviting via email/phone, or by syncing your
   phone contacts against existing accounts.

## Tech stack

- **React Native + Expo** (SDK 52, RN 0.76.5), **expo-router** for
  navigation, TypeScript throughout.
- **Local-first data**: every receipt lives in on-device **SQLite**
  first (`lib/database.ts`) — the app works fully offline. Cloud sync is
  a shadow-write on top (`lib/cloudSync.ts`), not the source of truth for
  a solo user.
- **Firebase**: Auth (email/password, Google, Apple), Firestore (cloud
  shadow-copy of receipts + household/membership state), Cloud Storage
  (receipt photos, once shared with a household).
- **AI parsing**: Gemini 2.5 Flash primary; a Cloudflare Worker
  (`scripts/parse-receipt-worker.ts`) as a secondary fallback when
  Gemini's free tier is exhausted; Anthropic classify also present as a
  code path (`lib/anthropicClassify.ts`) — check `lib/parser.ts` for
  current provider selection logic.
- **Email**: EmailJS (household invite emails), sent from a connected
  Gmail account — no dedicated transactional email service.
- **Push notifications**: Expo's hosted push service, called directly
  from whichever device causes the event (no backend) — see
  `lib/notifications.ts`.
- **Hosting**: Cloudflare Pages for the legal pages (privacy/terms) and
  a couple of static landing pages (`firebase-hosting/` — the directory
  name is legacy/misleading, it's actually deployed via `wrangler pages
  deploy`, not Firebase Hosting).
- **CI/CD**: GitHub Actions. See "Build & release pipeline" below.
- **Tests**: Jest, 4 projects (unit / component / performance /
  regression) — 590+ tests, gates CI. `npx jest` before any commit.

## Why local-first + no real backend

There is deliberately **no custom backend server**. Every cross-device/
cross-user feature (household invites, phone/email discovery, push
notifications, balance settlement) is built as **client-side Firestore
writes governed entirely by `firestore.rules`**, plus the occasional
direct call to a third-party API (Expo's push service, EmailJS). This
is a considered constraint, not an oversight — the Firebase project is
on the free **Spark plan**, which has no Cloud Functions. Every "how do
I do X across users safely" problem in this codebase gets solved by
designing a Firestore security rule + a client transaction, never by
reaching for a server. See `lib/cloudSync.ts`'s `phoneIndex`/`emailIndex`
collections and `firestore.rules` for the clearest example of this
pattern (a "discovery index" any signed-in user can read, but only the
owning uid can write, used so one user's contacts-sync can find another
user's account without a backend).

## Core data model

- **`Receipt`** (`types/index.ts`) — the central record. Has `lineItems`
  (each with its own category and optional `splitWith`), an optional
  `split` block (`method: 'equal' | 'percent' | 'amount' | 'shares'`,
  `participantIds`, per-participant `values`), `paidBy` / `createdBy`
  (who fronted the money vs. whose household the expense belongs to —
  these are deliberately separate, Splitwise-style), and an optional
  `recurring` config.
- All monetary fields are **USD-canonical internally** — anything shown
  to a user is converted via `formatCurrency`/`convertToUsd`/
  `convertFromUsd` (`lib/currency.ts`) at the boundary. Never store or
  compare a non-USD number directly.
- **Household** — the sharing/multi-user unit. A user can belong to
  multiple households (`lib/AuthContext.tsx`'s `memberships`); one is
  "active" at a time. Every new user gets a solo household automatically
  on first sign-in.
- **Balances** (`lib/balances.ts`) — computed client-side from receipts
  + settlements, never stored as a running total, so they're always
  correct even if editing history changes.

## Directory map

```
app/            expo-router screens (file-based routing)
  (tabs)/         the 4 main tabs: index (dashboard), scan, history, reports, settings
  edit/[id].tsx   edit an existing receipt
  households.tsx  multi-household switcher
  contacts-sync.tsx   bulk contacts scan → match/invite household members
  settings.tsx    profile, household members, notifications, theme, legal
lib/            all business logic — no logic lives in components/screens beyond wiring
  database.ts     local SQLite (source of truth)
  cloudSync.ts    Firestore shadow-sync + household/invite/discovery logic (the biggest file)
  balances.ts     split-expense math
  parser.ts / geminiParseReceipt.ts / cloudflareReceiptParse.ts   OCR → structured receipt
  notifications.ts    push notification send/receive
  AuthContext.tsx     the app's top-level auth/household/profile React context
components/ui/  shared UI primitives (Toast, ModalHeader, EmptyState, SplitSection, ...)
constants/      theme (colors/spacing/type), category list
plugins/        custom Expo config plugins (Gradle patches — see below)
firestore.rules the entire cross-user security model, in one file
firebase-hosting/  static legal/landing pages, deployed via wrangler to Cloudflare Pages
scripts/        Cloudflare Worker (AI-parse fallback), one-off ops scripts
__tests__/      Jest, 4 projects (unit/component/performance/regression)
docs/           store-listing copy, older planning docs (see PLAN.md for current status)
```

## Naming

| Layer | Name | Change? |
|---|---|---|
| Store / in-app display | **NestExpenseTracker** | Canonical — keep this everywhere user-visible |
| GitHub repo | historically `BalanceSheet` | Safe to rename in GitHub Settings; update README clone URLs |
| npm `package.json` `name` | `nest-expense-tracker` | Cosmetic |
| EAS `slug` / deep-link `scheme` | `receipt-scanner` | **Leave** — tied to EAS project + existing app links |
| Android/iOS bundle id | `com.*.receiptscanner` | **Leave** — store listing continuity |
| Native iOS folder names | `ReceiptScanner` / variants | **Leave** unless doing a careful Xcode rename |

Do not "fix" bundle ids or the EAS slug as part of a branding pass.
Do fix READMEs, store listing copy, and static hosting pages when they
still say BalanceSheet / Receipt Scanner.

## Build & release pipeline

Three GitHub Actions workflows:

- **`test.yml`** — reusable, runs the Jest suite. Gates the other two.
- **`android-build.yml`** — `workflow_dispatch` (pick profile) + push to
  `main` / `feature/**` / `fix/**`. Runs `eas build --local` on the
  runner. Default push profile is **preview** → sideload `.apk`.
- **`release-build.yml`** — runs on every push to `main` (and
  `workflow_dispatch`). Local **production** Android `.aab` on the
  runner (no EAS cloud credits, **no auto-submit**). Download from the
  run's Artifacts and upload to Play Console yourself. iOS is not built
  here — archive via Xcode / TestFlight (see HANDOVER.md).

Both `app.config.js` and `app.json` carry the same `version`/
`buildNumber`/`versionCode` literals — `app.config.js`'s copy is what's
actually read; `app.json`'s is for a human glancing at the repo.
`autoIncrement` is off on both platforms, so these are bumped by hand,
every time, in both files, before any release-affecting push.

### Custom Expo config plugins (`plugins/`)

A few Android build properties Expo/`expo-build-properties` doesn't
expose are patched directly by hand-written config plugins that edit
the generated `android/build.gradle` text:

- `withNdk27.js` — forces NDK r27 project-wide (Google Play's 16 KB
  memory-page-size policy needs it). **Known limitation**: this only
  affects code *this project* compiles — it cannot retroactively fix
  prebuilt `.so` binaries already baked into `react-native`, Hermes,
  `react-native-reanimated`, `react-native-screens`, `expo-modules-core`,
  or `expo-sqlite` at whatever NDK their maintainers used. See PLAN.md's
  "16 KB page size" blocker for the real fix (a dependency upgrade).
- `withGradleJvmHeap.js` — raises the Gradle daemon heap (R8 OOM'd
  without this once shrinking was enabled).
- `withGooglePlayAdiToken.js` — writes Play Console's one-time
  package-ownership verification token into the built APK.

## Known constraints worth internalizing

- **Firebase Spark plan (free), no Cloud Functions.** Every "backend"
  need is either a client-side Firestore transaction + security rule,
  or a call to Expo's push service / EmailJS / the Cloudflare Worker.
- **No Twilio/SMS account.** Phone invites hand the invite text to the
  OS share sheet (`Share.share`) so the *inviter* sends it themselves —
  free, no third-party SMS billing.
- **Android's `android/` and iOS's `ios/` directories are NOT the same
  kind of thing.** `android/` is fully gitignored — regenerated fresh by
  `expo prebuild` on every build (Continuous Native Generation). `ios/`
  **is tracked in git** (bare workflow) — any hand-edit under `ios/`
  needs a normal commit.
- **Native module rebuild lag.** Adding a new native Expo module
  (contacts, notifications, etc.) to `package.json` doesn't do anything
  until the next full native rebuild — code that calls a not-yet-linked
  native module is written to lazy-`require()` it and no-op gracefully
  (see `lib/expoContacts.ts` for the pattern), so the app stays usable on
  an un-rebuilt install.
- **Play Store is not fully live yet** — see PLAN.md for the exact
  blocking issue (16 KB page size support needs a dependency upgrade).
  App Store (iOS) has its own separate, further-along status — also in
  PLAN.md.
- **Only run `/code-review` before non-trivial commits and verify with
  `npx tsc --noEmit -p .` + `npx jest`** — this is an established norm
  for this repo, not just a one-off preference.

## Where to look next

- **[README.md](README.md)** — quick start / local dev setup, env vars needed.
- **[HANDOVER.md](HANDOVER.md)** — rolling session-to-session state: what
  the last session did, open threads, gotchas discovered in the moment.
  Check this fresh every session — it changes constantly and can go
  stale fast; this file (CONTEXT.md) is the part that doesn't.
- **[PLAN.md](PLAN.md)** — what's shipped vs. what's next.
- **`docs/`** — store listing copy, an older (partially superseded) v1.1
  roadmap doc — cross-check against PLAN.md for what's still accurate.
