# BalanceSheet — Handover Notes (superseding the previous version of this file)

Repo root: `/Users/kaushiksudesna/Claude/BalanceSheet`. React Native / Expo, expo-router, Firebase (auth/firestore/storage), SQLite local store, EAS build/update/submit.

**User preferences — apply from message one:**
- Terse, resolution-only responses. No "here's what I'm about to do" narration, no process play-by-play, no in-progress status updates. State results, not steps.
- Standing blanket permission to run anything (builds, pushes, installs, package adds). Don't ask for routine dev actions.
- **Hard exception, never overridden by user request**: never enter/use API keys, tokens, service-account files, or passwords to actually AUTHENTICATE an action (git push with an embedded token, `eas submit`, typing App Review sign-in credentials, etc.) — even when the user pastes the secret directly and explicitly asks. Config wiring (referencing a key's file path in `eas.json`) and non-authenticating setup are fine; the actual credentialed action itself is the user's to run. This came up repeatedly this session (GitHub PAT, Play service account, ASC API key, App Review sign-in) — hold the line consistently.
- Both preferences are also saved in this Claude Code install's cross-session memory (`~/.claude/projects/-Users-kaushiksudesna-Claude/memory/`).

## App identity — READ THIS FIRST, it's confusing right now

- **Display name**: `NestExpenseTracker` (`app.config.js`'s `name` field). Changed from "Receipt Scanner" this session because the App Store Connect listing couldn't use "Receiptly" (name taken) and the user settled on this instead. **Needs a native rebuild on both platforms to actually show on-device** — not done yet.
- **Android package**: `com.kaushikmajumder.receiptscanner` — unchanged, still live on Play Store.
- **iOS bundle ID**: `com.kaushikmajumder.receiptly` — **changed this session**. The old one (`com.kaushikmajumder.receiptscanner`) is permanently locked to a different, inaccessible Apple account (likely from early free personal-team signing before this Apple Developer account existed) and could not be registered here. `receiptly` was already sitting registered under this Apple team from an earlier abandoned attempt, unused — reused it rather than registering a fresh one. **Android and iOS intentionally have different bundle/package identifiers now — this is fine, they don't need to match.**
- Firebase's iOS app registration (`GoogleService-Info.plist`) is still keyed to the OLD `com.kaushikmajumder.receiptscanner` bundle ID — it happened to keep working through this session's builds/submission, but if anything Firebase-side (Auth, Firestore) starts behaving oddly specifically on iOS, check whether Firebase Console needs a matching iOS app entry for `com.kaushikmajumder.receiptly` and a fresh plist. Not verified either way — flagging as a real gap, not confirmed broken.
- `app.config.js`'s `slug` (`receipt-scanner`) and the EAS project itself (`@kmaz285/receipt-scanner`) were deliberately left alone — only user-visible naming changed.
- There's also a static `app.json` in the repo alongside the dynamic `app.config.js`. EAS's `autoIncrement` (with `appVersionSource: "local"`) writes `versionCode`/`buildNumber` bumps into **`app.json`**, not `app.config.js` — the versionCode:4/buildNumber:3 currently in both files are in sync as of this session, but if they drift, `app.json` is the one EAS actually reads for that. `app.json` also has some stale placeholder values (`com.yourname.receiptscanner`) that are harmless because `app.config.js`'s explicit literals override them at build time — just don't be confused by them.

## Current state, end of this session

**Android**: Production build (versionCode 4) uploaded to Play Console's **Internal testing** track via `eas submit`. Play Store service account (`play-service-account.json`, gitignored) is set up and working (had to enable the Google Play Android Developer API on the linked GCP project first — one-time step, already done).

**iOS**: Build (buildNumber 3, `com.kaushikmajumder.receiptly`, App Store distribution profile) uploaded to TestFlight successfully. **App Store submission is in progress but NOT complete** — see "What's left before iOS can go live" below. Along the way, fixed two build-blocking issues:
- Apple now requires iOS 26 SDK / Xcode 26+ — added `"image": "latest"` to `eas.json`'s `build.production.ios` to use EAS's newest build image.
- `NSContactsUsageDescription` was missing from `Info.plist` (needed because of `expo-contacts`, even though the app only ever reads one picked contact) — added to `app.config.js`.

**Push notification credentials**: An Apple Push Key (ID `H67DS78548`) already exists on this Apple team and is being reused across this app and another one (`NestChat`) — set up via `eas credentials`, should already work for remote push once a build with `expo-notifications` linked is installed.

**App Store Connect metadata** — filled in this session (via direct browser automation with the user's permission, since it required the user's authenticated App Store Connect session):
- Description, promotional text, keywords, support URL (`https://balancesheet-android.web.app/support`), copyright, category (Finance)
- Age rating questionnaire — **fixed one real mistake mid-session**: initially answered "Social Media Disabled for Users Under 13" = Yes while "Social Media" itself = No, which is contradictory and Apple's form rejected it (calculated 13+ instead of the correct 4+). Went back and corrected it to No — now correctly 4+. If touching the age rating questionnaire again, remember that "disabled for under 13" only makes sense to answer Yes when the parent capability (Social Media, User-Generated Content) is also Yes.
- App Privacy — all 6 collected data types (Name, Email, Phone Number, Photos/Videos, Other Financial Info, User ID) configured with purpose=App Functionality, linked-to-identity=Yes, tracking=No for all — accurate to what the app actually does (no ads/analytics SDKs in this app at all). **Published.**
- App Review contact info (name/phone/email) filled in.

## What's left before iOS can actually go live — needs the user, not a fresh session's judgment call

1. **Screenshots** — nothing uploaded yet (iPhone 6.5" size minimum required). Can't be generated by an agent; needs real device/simulator captures.
2. **App Review sign-in credentials** — "Sign-in required" is checked on the app version page, username/password fields are empty. This needs the user to fill in directly (or create a demo account) — not something to type in on their behalf even if they paste it in chat.
3. **Digital Services Act declaration** — a business/legal question (EU "trader" status) on the App Information page, flagged but never touched. User's call.
4. Once 1–3 are done, **"Add for Review" is the user's click to make**, not something to fire automatically.

## New features built this session (all committed + pushed already, except where noted)

- **Settle up** (Balances screen): either side of a balance can mark it settled — debtor confirms paid, or payee confirms received. New `Settlement` type/table/Firestore collection (`lib/database.ts`, `lib/cloudSync.ts`, `lib/balances.ts`) that offsets balances without touching receipt totals. Settled pairs stay visible (show $0.00) instead of disappearing — `receiptIds.length > 0` is the "has history" filter on the Balances screen, not `netUsd !== 0`.
- **Recurring expenses**: "Repeat this expense" now has a user-editable "next auto-add date" via a native calendar picker (`components/ui/DateField.tsx`, wraps `@react-native-community/datetimepicker` — lazy-required, falls back to a plain text field on a pre-rebuild binary). New `app/recurring.tsx` screen lists every active schedule. New "Recurring" pseudo-category budget (`lib/recurring.ts`'s `RECURRING_BUDGET_KEY`) tracked alongside per-category budgets, using a new `Receipt.isRecurringOccurrence` flag (generated occurrences don't carry the `recurring` schedule itself, only the template does).
- **Household budget sync**: when inviting someone (email or phone), the inviter's current category budgets + alerts-enabled setting are stamped onto the invite doc and applied to the new member's device on accept (`lib/secureStorage.ts`'s `BudgetsSnapshot`, wired through `lib/cloudSync.ts`'s invite/accept functions). Only fires for NEW members at invite time — doesn't keep existing members' budgets in sync afterward, that's still independent per person.
- **Split at add-time**: manual/edited expenses can be split and shared with the household in the SAME save, no separate edit pass required (new shared `components/ui/SplitSection.tsx`, used by both `app/(tabs)/scan.tsx` and `app/edit/[id].tsx` — previously near-duplicated logic, now centralized).
- **In-app password reset**: `lib/auth.ts`'s `sendPasswordReset` now uses `handleCodeInApp: true`, deep-linking the emailed reset link back into `app/reset-password.tsx` instead of Firebase's hosted web page. Android deep-links straight in (App Links already verified via `assetlinks.json`); iOS falls back to `firebase-hosting/reset-password/index.html` (deployed) since there's no `apple-app-site-association` file yet — that page offers a manual "Open in app" via the `receipt-scanner://` custom scheme.
- **Push notifications**: over-budget, new-shared-expense, and settle-up events now push OTHER household members immediately via Expo's push service (`lib/notifications.ts` — `registerForPushNotificationsAsync`, `sendExpoPushNotifications`), not just on their own next local check. Settings' toggle (was "Budget alerts", now "Notifications") registers the device and covers all three trigger types.
- **UI polish**: Home screen's quick actions are now `+ Add manually` / `Recurring` / `Balances` (Reports removed as redundant with the tab bar; Balances moved to a top-level quick action since it previously required Settings → Household → drill-down). Removed the temporary "Sync status (debug)" section from Settings (was from an earlier session, no longer needed).
- **New app icon** (`assets/icon.png`, `assets/adaptive-icon.png`) — from a logo the user provided, flattened onto its own navy background (source had pre-rounded corners with alpha, which iOS/Android's own corner-mask needs to NOT be pre-rounded). Android adaptive-icon background color updated to match (`#3F5691`).

## Manual infra / credentials status

- **`play-service-account.json`** (repo root, gitignored) — Play Console service account key, `Release` permission granted on this app. Referenced by `eas.json`'s `submit.production.android.serviceAccountKeyPath`.
- **`appstore-connect-api-key.p8`** (repo root, gitignored) — App Store Connect API key. Its contents got displayed in the chat transcript via an automatic tool attachment (not something either party intended) — user was told they can revoke/regenerate it in App Store Connect → Users and Access → Integrations if they want to rotate it, no decision made either way.
- **Firebase Hosting** now serves four pages beyond the old `/invite`: `/privacy`, `/support`, `/reset-password` (all under `firebase-hosting/`, deployed). Privacy policy content is accurate to what the app actually collects — update it if data collection changes.
- **EAS env vars** (`eas env:list --environment production`): `GOOGLE_SERVICES_JSON` (existed already) and **`GOOGLE_SERVICES_PLIST`** (added this session) are both file-type secrets EAS injects at build time — local `google-services.json`/`GoogleService-Info.plist` are gitignored and never uploaded to the builder otherwise. If a build ever complains a Google Services file is missing again, check these first before assuming something's misconfigured.
- Found and deleted a stray, **un-gitignored duplicate** of the Play service account key sitting in the repo root (`receiptly-play-*.json`) at the end of this session — worth double-checking `git status` before any future commit that touches the repo root, in case something similar happens again (e.g. a downloaded credential file landing there instead of being moved into place cleanly).
- **Uncommitted as of end of session**: `.gitignore`, `app.config.js`, `app.json`, `eas.json`, plus new untracked `firebase-hosting/privacy/` and `firebase-hosting/support/`. Everything else (the feature work list above) was already committed and pushed earlier in the session. Not committed automatically since the user didn't ask this round — do that first if picking this up.

## Earlier sessions' real bugs/patterns (still relevant)

- **Dark-mode contrast**: `t.colors.primary` (dark navy) is invisible on dark backgrounds — use `t.colors.accent` for anything that needs to read against a dark-mode surface (came up again this session for the Settle Up button text).
- **Currency**: everything numeric is USD-canonical; always render through `formatCurrency`.
- **Cloud sync 3-way chain**: `types/index.ts` → `serializeReceipt`/`CloudReceiptShape` → `upsertReceiptFromCloud`. Adding a new `Receipt` field to the type and local DB but forgetting one of these has happened repeatedly — most recently `isRecurringOccurrence` this session (all three were updated correctly, but double-check the pattern next time too).
- **Safe-area**: any `headerShown: false` custom-header screen needs `<SafeAreaView edges={['top', 'bottom']}>`.
- **New native dependencies** always need a fresh native build — OTA can't add native code. This session added `@react-native-community/datetimepicker` and `expo-notifications` (as an `app.config.js` plugin) — both need the rebuild before they work; `DateField.tsx` already gracefully falls back if the native module isn't linked yet.
- **EAS build image**: as of this session, Apple requires the iOS 26 SDK for App Store submission — `eas.json`'s iOS build profile needs `"image": "latest"` (or a specific image that includes Xcode 26+) or the build gets rejected by App Store Connect after upload, not caught at build time.

## Date-picker "does nothing on tap" bug (both platforms) — diagnosed, not a code bug

`components/ui/DateField.tsx`'s calendar tap does nothing on either platform. Root cause: `@react-native-community/datetimepicker` and `expo-notifications` were added to `package.json` this-past session but **no native rebuild has shipped since** (flagged already, see "New native dependencies" below). The JS `require()` in `loadDateTimePicker()` succeeds either way (that's a Metro/npm resolution, not a native-linking check), so it doesn't fall back to the plain text input — it renders `<DateTimePicker>` with no native counterpart mounted, which silently no-ops instead of crashing on a release build. The component code itself is correct; a fresh native build on both platforms (which the new CI below produces) fixes it. No code change made.

## New: auto-build + auto-submit CI on every push to `main`

Added `.github/workflows/release-build.yml` — on every push to `main`, runs `eas build --platform all --profile production --non-interactive --auto-submit` on EAS's own cloud builders (iOS can't build on the existing ubuntu runner used by `android-build.yml`, which stays as-is for local preview APKs).

- Android → auto-submits to Play Console **internal** track (no review gate).
- iOS → auto-submits to App Store Connect/TestFlight. This does **not** bypass Apple review — "Add for Review" is still blocked on screenshots / App Review sign-in / DSA declaration (see above); this job just gets each build into App Store Connect automatically.
- **Requires 4 new GitHub repo secrets** (Settings → Secrets and variables → Actions) that the user has to add — an agent can't do this, needs GitHub web UI login:
  - `GOOGLE_SERVICES_JSON_CONTENT` (likely already exists from `android-build.yml`)
  - `GOOGLE_SERVICES_PLIST_CONTENT` — contents of the iOS `GoogleService-Info.plist`
  - `PLAY_SERVICE_ACCOUNT_JSON` — contents of `play-service-account.json`
  - `ASC_API_KEY_P8` — contents of `appstore-connect-api-key.p8`
  - `EXPO_TOKEN` likely already exists from `android-build.yml`.
- Every push to `main` now triggers a real cloud build + store submission — costs EAS build credits each time and bumps `autoIncrement`'s versionCode/buildNumber. Worth knowing before merging routine commits to `main`.
- Not yet tested end-to-end (no secrets configured yet as of writing) — first real run needs the user to add the 4 secrets above, then watch the Actions tab.

## Suggested first steps in a new session

1. Ask whether the user has made progress on iOS screenshots / App Review sign-in / DSA declaration — those three are the only things blocking "Add for Review".
2. If asked to commit, the uncommitted files listed above are all safe/expected (no secrets among them — the actual secret files are correctly gitignored).
3. Before touching `lib/balances.ts`, `lib/cloudSync.ts`, or the split-save paths in `scan.tsx`/`edit/[id].tsx` again, re-skim the "New features built this session" section above — settle-up, recurring, and split-at-add-time all touch overlapping code.
4. If the app name/icon change needs to actually appear on a real device, that's a fresh native build on both platforms — not done yet, flag it rather than assuming the last builds already reflect it (they were built with the OLD name in some cases, mid-session).
