# Plan

What's shipped, what's blocking release right now, and what's next.
Pair this with [CONTEXT.md](CONTEXT.md) (the stable "how this app is
built" picture) and [HANDOVER.md](HANDOVER.md) (rolling session notes).
Update this file's "Achieved" list and "Next up" section as work lands
or priorities shift — it should stay a true reflection of reality, not
a stale wishlist.

## What we've achieved

**Core product**
- Camera/gallery receipt capture → on-device OCR → AI-structured receipt
  (merchant, date, line items with per-item categories, subtotal, tax,
  total), with a Cloudflare Workers AI fallback so parsing survives the
  primary AI provider's free-tier limits.
- Manual receipt entry and full editing, including per-item categories
  and per-item split overrides.
- Local SQLite as source of truth; the app is fully usable offline.
- Dashboards: month-over-month spend, category breakdowns, top stores,
  recurring-purchase detection, PDF export.
- Multi-currency support (USD-canonical storage, display/convert at the
  UI boundary).

**Accounts & households**
- Email/password, Google, and Apple sign-in.
- Multi-household support — a user can belong to several households,
  one active at a time; every new user gets a solo household by default.
- Splitwise-style expense splitting: equal / percent / dollar-amount /
  share-count (including fractional shares, e.g. 0.5/0.7), with
  per-member running balances and a settle-up flow.
- Household invites by email (EmailJS-delivered link) and by phone
  (OS share-sheet, since there's no SMS billing account) — both
  auto-join the invitee with no accept tap for phone, an explicit
  accept/decline for email.
- **Contacts sync**: scan the device address book, match against
  existing accounts (phone or email), add matches directly or send
  invites to the rest — plus real push notifications to matched
  contacts the moment they're added/invited, even if their app is
  closed, via a `phoneIndex`/`emailIndex` discovery mechanism that
  works without a backend.
- Live Firestore listeners so a pending invite is picked up while the
  recipient's app is already open, not just at their next sign-in.

**Polish / trust**
- Dark/light/system theme, actually following the OS setting.
- Budget alerts (opt-in, permission requested only on toggle-on).
- Push notifications for shared-expense activity, settle-ups, budget
  status — sent client-side via Expo's push service, no backend.
- Privacy policy + terms pages (Cloudflare Pages), account deletion,
  camera/photo purpose strings — the standard app-store trust bar.
- Email domain autocomplete and contacts search UX polish on the invite
  flows.
- Google Play's photo/video permissions policy compliance (system
  picker only, no broad `READ_MEDIA_IMAGES` request).

**Engineering health**
- 590+ Jest tests across 4 projects (unit/component/performance/
  regression), gating CI.
- Three-workflow CI/CD: test gate, manual local Android build, and
  fully automatic cloud build+submit to Play Console/TestFlight on
  every push to `main`.
- `/code-review` run before every non-trivial commit as standing
  practice, not a one-off ask.

## Current blockers to a real production release

### 1. Google Play — 16 KB memory page size (blocking, in progress)

Play Console rejects every upload with "Your app does not support 16 KB
memory page sizes." Root cause, confirmed by directly inspecting the
built `.aab`'s native libraries: `libreactnative.so`, `libhermes.so`,
`libreanimated.so`, `librnscreens.so`, `libexpo-modules-core.so`,
`libexpo-sqlite.so` and others are **prebuilt binaries** shipped inside
their respective npm packages (react-native 0.76.5, Hermes bundled with
it, react-native-reanimated 3.16.1, react-native-screens 4.4.0, Expo SDK
52's expo-modules-core/expo-sqlite), all built at 4 KB page alignment.

A project-level NDK bump (already done — see `plugins/withNdk27.js`)
only affects code *this* project compiles; it cannot retroactively
realign someone else's already-published binary. **The real fix is a
dependency upgrade**: react-native to ≥0.77 (the version where Meta's
own prebuilts became 16 KB-aligned) plus matching upgrades to
react-native-reanimated, react-native-screens, expo-modules-core, and
expo-sqlite. Likely means moving off Expo SDK 52 (SDK 52 officially
defaults to RN 0.76.x; Expo ships a narrow SDK52↔RN0.77 compat shim,
but the clean path is probably Expo SDK 53+).

**Next up**: scope the upgrade — check exact minimum compatible versions
for react-native/reanimated/screens/expo-modules-core/expo-sqlite,
assess breaking changes (especially in reanimated/screens, which have
had major-version native API churn), do the upgrade on a branch, run
the full test suite + a real device smoke test before merging. This is
a real risk-carrying change, not a config tweak — don't rush it right
before a release deadline.

### 2. Google Play — target API / other policy items

API 36 (Android 16) targeting is already in place and confirmed
working in CI. Re-check Play Console's Policy status page after the
16 KB fix lands, in case anything else surfaces once that gate clears.

### 3. iOS — App Store review

Status as of last check: further along than Android, but has its own
open checklist (see HANDOVER.md's most recent notes for exact current
blockers — this changes session to session, don't trust this file for
that level of freshness).

## Next up (once the blockers above clear)

Loosely ordered, not committed — re-evaluate against real user feedback
once something is actually live.

1. **Ship the RN/dependency upgrade**, get an Android build past Play
   Console, get both platforms actually live in production (not just
   Internal/TestFlight).
2. **In-app feedback → Jira pipeline** (spec already written, see
   `docs/V1.1_ROADMAP.md` §1) — lets real users report bugs/requests
   without leaving the app.
3. **Decide the "notify me when a fix is ready to test" mechanism**
   (`docs/V1.1_ROADMAP.md` §2 — three options laid out, no decision
   made yet).
4. **Re-evaluate the admin web app question** (`docs/V1.1_ROADMAP.md`
   §3) after 2-3 weeks of real production usage — most needs may
   already be covered by the Firebase Console + Jira directly; don't
   build it speculatively.
5. **Crash reporting** (Firebase Crashlytics or similar) — not set up
   yet, referenced as a gap in the v1.1 doc.

## Ideas not yet scoped (park here, don't lose them)

- Subscription/paid tier (explicitly deferred in `docs/V1.1_ROADMAP.md`).
- Multi-language support.
- Push notification campaigns / broadcast (needs an admin surface).
- App-config remote control (change categories/feature flags without a
  new build) — would need either Firebase Remote Config (free tier
  covers this, doesn't need Blaze) or a simple Firestore-backed config
  doc read at app launch.

## Note for whoever picks this up next (human or AI)

This file is a snapshot — the "Current blockers" section especially
will go stale fast. Before acting on it: check `git log` for anything
that's landed since, check HANDOVER.md for the latest session's actual
findings, and re-verify any "not yet done" claim here against the
current code before treating it as fact.
