# BalanceSheet — Handover Notes (supersedes the previous version of this file)

Repo root: `/Users/kaushiksudesna/Claude/BalanceSheet`. React Native / Expo, expo-router, Firebase (auth/firestore/storage), SQLite local store, EAS build/update/submit. Current HEAD: `3499e07` ("Bump Android versionCode to 10 before next closed-testing upload"). App is marketed as **NestExpenseTracker** now (see rebrand section below) — repo/folder names and some internal identifiers still say BalanceSheet/ReceiptScanner on purpose (see below).

**User preferences — apply from message one:**
- Caveman-mode terse responses, every session, by default (saved in cross-session memory — see below). Minimize tokens overall: silent progress (no intermediate "still running"/"step N done" pings — only speak up on real failures or final completion), dense turns, batched tool calls.
- Standing blanket permission to run anything (builds, pushes, installs, package adds). Don't ask for routine dev actions. Only ask when a decision genuinely needs the user's call (e.g. investment-level tradeoffs, ambiguous bug symptoms you can't reproduce without a device).
- **User explicitly asked: don't trigger `eas build` directly from the CLI — only via the GitHub Actions workflows** (push to `main` for `release-build.yml`, or `gh workflow run android-build.yml -f profile=production` for the local Android build). This came up after a local `eas build` CLI run (used only for credential debugging) burned a cloud build credit outside the visible CI trail.
- **Hard exception, never overridden by user request**: never enter/use API keys, tokens, service-account files, or passwords to actually AUTHENTICATE an action (git push with an embedded token, `eas submit`, typing App Review sign-in credentials, Apple ID login, etc.) — even when the user pastes the secret directly and explicitly asks. Config wiring and non-authenticating setup are fine; the actual credentialed action itself is the user's to run. (This is why `eas credentials --platform ios` Apple-login steps were always handed back to the user rather than done here.)
- Also saved in this Claude Code install's cross-session memory (`~/.claude/projects/-Users-kaushiksudesna-Claude/memory/`) — check `MEMORY.md` there fresh each session.

## Immediate next step — pick this up first

Both a fresh Android `.aab` (versionCode 10, commit `3499e07`) and an iOS build path are ready to ship, but **nothing has been re-submitted to Apple App Review yet** since the 5-item rejection (see below) was addressed:
1. Confirm the user has uploaded versionCode 10's `.aab` to Play Console's closed testing track (it was downloaded and sent to them, not auto-uploaded — Play Store submission is manual by their choice).
2. For iOS: the user has been doing **local Xcode archive → TestFlight** uploads (bypassing exhausted EAS build credits), not the CI `release-build.yml` path. `CURRENT_PROJECT_VERSION` is at **7** in the committed `project.pbxproj` — confirm what's actually on TestFlight before archiving again; bump to 8+ if 7 is already up there.
3. Once a build with all 5 Apple-review fixes is on TestFlight, the user still owes Apple: a screen recording of guest-login → Settings → Delete account (for 5.1.1(v)), and a reply to the 4.8 note confirming Sign in with Apple is now offered. Neither has been sent yet as of this writing.
4. `eas build` cloud credits were at ~90% used and climbing during this session (multiple failed/retried iOS builds) — check https://expo.dev/accounts/kmaz285/settings/billing before assuming a CI-triggered `release-build.yml` iOS build will even start.

## This session: full rebrand to NestExpenseTracker

The App Store Connect listing name is **NestExpenseTracker** (already set months ago in `app.config.js`'s `name` field), but the app still displayed "Receipt Scanner"/"Receiptly"/"BalanceSheet" in numerous user-visible places. All fixed this session:

- **iOS home-screen name + system dialogs**: `ios/ReceiptScanner/Info.plist`'s `CFBundleDisplayName` **and** `CFBundleName` (the latter is what Google/Apple's native "X wants to use accounts.google.com" system dialogs actually read — fixing only `CFBundleDisplayName` left that dialog still saying "ReceiptScanner" even in a build with the display-name fix already in it. Learned this the hard way after the user re-tested).
- Camera/photo-library/FaceID/contacts/microphone **permission-prompt strings** (Info.plist + `app.config.js`'s `infoPlist`/plugin config + `app.json`).
- Login screen's split-styled logo text (`app/auth.tsx`) — was literally `"Receipt" + "ly"`, now `"Nest" + "ExpenseTracker"`.
- PDF export title/footer, CSV export filename, budget-alert notification copy, phone-invite SMS text — all said "BalanceSheet".
- Google Cloud Console **OAuth consent screen App name** (Branding tab, project `balancesheet-android`) — user changed this manually from `project-858326644205` to `NestExpenseTracker`. This is a *different* mechanism from the iOS system dialog above; both needed fixing independently.

**Deliberately NOT renamed** (all real, live infrastructure identifiers — renaming any of these breaks the live App Store/Play Store listing, deep links, or Firebase project, independent of display branding):
- `ios.bundleIdentifier: 'com.kaushikmajumder.receiptly'`, `android.package: 'com.kaushikmajumder.receiptscanner'`
- Firebase Hosting domain `balancesheet-android.web.app` (used for password-reset/invite deep links, AASA)
- The GitHub repo name, npm package name (`receipt-scanner`), EAS project slug (`receipt-scanner`), URL scheme (`receipt-scanner://`)
- iOS Xcode project/target internals (`PRODUCT_NAME = ReceiptScanner`, folder `ios/ReceiptScanner/`, Pods target names) — changing these risks breaking the *just-barely-working* iOS build pipeline for a purely cosmetic gain; only the two literal Info.plist string keys were changed, not the underlying build settings.

## This session: Apple App Review — all 5 items addressed in code

Apple rejected the app on 5 grounds; each is now fixed in committed code (not yet re-submitted — see Immediate next step):

1. **Guideline 4.8 (missing equivalent login — Sign in with Apple)**: was a literal stub (`toast.show({ message: "Apple sign-in isn't available yet" })`). Now a real implementation: `expo-apple-authentication` + `expo-crypto` installed, nonce-hashed flow in `lib/auth.ts`'s `signInWithApple()`, wired in `app/auth.tsx`'s `AppleButton` (hides itself via `AppleAuthentication.isAvailableAsync()` on Android/unsupported iOS). Needed, and done, on three separate systems: (a) code — done; (b) Apple Developer Portal — user enabled the "Sign In with Apple" capability on the App ID and it's confirmed saved; (c) Firebase Console — user enabled Apple as a sign-in provider (confirmed via screenshot, alongside Google/Anonymous/Phone/Email, all green). Entitlement (`com.apple.developer.applesignin`) added to both `ios/ReceiptScanner/ReceiptScanner.entitlements` and `...Release.entitlements`.
2. **Guideline 5.1.1(ii) (vague camera purpose string)**: `NSCameraUsageDescription`/`NSPhotoLibraryUsageDescription` (Info.plist) and the matching `expo-camera`/`expo-image-picker` plugin strings (Android) rewritten to state exactly what's extracted ("...reads the merchant name, date, and total from that photo...") instead of the generic "needs camera access."
3. **Guideline 2.3.8 (name mismatch)**: this is the `CFBundleDisplayName`/`CFBundleName` fix described in the rebrand section above — Apple's review had seen a build from *before* that fix landed.
4. **Guideline 5.1.1(v) (no account deletion)**: `AuthContext.tsx`'s `deleteAccount()` (wipes cloud data, local receipts/profile, SecureStore, then the Firebase account) **already existed** but no screen ever called it. Added a "Delete account" row in Settings with a destructive-style confirmation `Alert`, right below "Sign out".
5. **Guideline 2.1(a) (guest sign-in crashed)**: root cause was Firebase's Anonymous sign-in provider simply never being enabled in Firebase Console (`[auth/unknown] This operation is restricted...`) — a config issue, not code. User enabled it (confirmed via screenshot). **Not re-tested end-to-end in the running app since** — worth confirming on the next real device test.

## This session: iOS CI — GoogleService-Info.plist delivery fixed at the root

A НEW, different root cause from the three already-documented in prior sessions (bare-workflow runtimeVersion, wrong staging path, EAS_NO_VCS) kept failing the `release-build.yml` iOS job at the Xcode *archive* stage (`CopyPlistFile` build phase, ~13 minutes into the build): `Build input file cannot be found: .../ios/ReceiptScanner/GoogleService-Info.plist`, even with `EAS_NO_VCS=1` staging the file correctly on the runner beforehand. Root cause: EAS's non-VCS archiver apparently doesn't reliably include this specific gitignored file regardless of the env var (contrary to what the existing workflow comment assumed).

**Fixed properly**, not by further fiddling with the upload step: added an `eas-build-post-install` npm hook (`package.json` → `scripts/write-google-services-plist.js`) that writes the file **directly on the EAS remote builder**, from the `GOOGLE_SERVICES_PLIST` secret that was *already* configured on EAS's own "production" environment (originally set up for managed-workflow Android, which reads it via `app.config.js`'s `googleServicesFile` field during prebuild — that mechanism never fires for iOS since `ios/` is bare, no prebuild runs. The new hook sidesteps prebuild entirely). Confirmed working: the next CI attempt's Xcode build succeeded and produced a real `.ipa`; it only failed at the *submit* step afterward, on an unrelated stale-build-number collision (see below).

**Separately, provisioning-profile bug found+fixed mid-session**: adding the Sign In with Apple entitlement made the *existing* EAS-managed provisioning profile stale (`doesn't include the Sign In with Apple capability`). Deleting the stale profile via `eas credentials --platform ios` → Build Credentials → "Provisioning Profile: Delete one from your project" (no Apple login needed for *deletion*) and then having the user log in via that same wizard (their own Apple ID, this session never touches credentials directly) → Build Credentials → "All: Set up all the required credentials" **regenerated a correct one** (Developer Portal ID `4QF72RXX8P`, confirmed active, includes the new entitlement).

## This session: iOS/Android build-number bookkeeping (manual, easy to forget)

Both platforms have `autoIncrement` off — bump by hand before every new build or the store rejects it as a duplicate:
- **iOS**: `CURRENT_PROJECT_VERSION` in `ios/NextExpenseTracker.xcodeproj/project.pbxproj` (two occurrences, Debug+Release) is the ONLY thing that matters — `app.config.js`/`app.json`'s `ios.buildNumber` field is dead for iOS since `ios/` is bare workflow (kept in sync for a human reader only). Currently **7**. Was bumped 5→6 (user, local archive)→7 (this session, after user's build-6 TestFlight upload) over the course of this session; a CI-triggered build still using the OLD un-bumped number collided with an already-submitted build once (harmless, just re-bump and retry).
- **Android**: `android.versionCode` in `app.config.js` (the literal that's actually used — `app.json`'s copy is for a human reader only, currently kept in sync). Bumped 8→9→**10** this session, each time before a Play Console closed-testing upload. **10 is the latest — confirm with the user whether it's actually been uploaded before bumping to 11.**

## This session: Home/Balances not refreshing after a notification tap (real race, not a UI bug)

User-reported: tapping a shared-expense/budget-alert push notification correctly navigated to Home, but showed stale data (new expense missing, budget status not updated) until a manual pull-to-refresh. Root cause: Home/Balances only ever reloaded local SQLite on navigation-focus or an `AppState` resume event — **neither is tied to when the Firestore listener (`subscribeToHouseholdReceipts`/`Settlements`/`Budgets` in `lib/cloudSync.ts`) actually finishes writing the incoming cloud change into local SQLite**. Resuming from a notification tap raced the listener reconnecting (it had likely been suspended while backgrounded) — the reload often ran and read *stale* rows moments before the real update landed, with nothing to trigger a second reload once it did. The same gap meant another household member's live change never appeared while a screen just sat open in the foreground, notification or not.

Fixed with a small pub/sub, `lib/dataSync.ts` (`onLocalDataChanged`/`notifyLocalDataChanged`) — the three cloudSync listeners call `notifyLocalDataChanged()` right after writing a change locally; Home (`app/(tabs)/index.tsx`), Balances (`app/balances.tsx`), and the per-member drill-down (`app/shared-expenses/[uid].tsx`) all now also reload on that signal, not just on focus/AppState events. Also fixed a smaller adjacent bug found in the same code: Home's `AppState` resume handler called `load()` but not `checkBudgetsAndNotify()` (only the focus-effect path did), so a budget-alert push could be silently skipped on resume even once data was fresh.

## This session: "Paid by" at the top level + partial payments (Splitwise-style)

Two related feature requests, both shipped:

1. **Top-level "Paid by", independent of Split.** Previously the payer picker only appeared once Split was toggled on AND a participant selected — so "I logged this personal expense but my roommate actually paid for it" (no splitting involved) had no way to be recorded. New `Receipt.createdBy` (immutable creator uid, stamped once at save, never touched by edits/cloud-upsert — distinct from `paidBy`, who fronted the cash) plus a new always-shown `components/ui/PaidBySection.tsx` picker (rendered whenever the household has other members, wired into both `app/(tabs)/scan.tsx` and `app/edit/[id].tsx`) replacing the old picker that used to be nested inside `SplitSection`. `lib/balances.ts`'s `computeReceiptNet` now also settles a **non-split** receipt when `createdBy !== paidBy`: the full amount is owed by the creator to the payer, auto-adjusting that pair's balance — split-enabled receipts and legacy pre-`createdBy` receipts are unaffected.

2. **Partial payments, not full-only settle-up.** Balances screen's "Settle up"/"Mark as received" always settled the *entire* owed amount — no way to record a real but partial payment without abusing the receipts table (which then wrongly counts it toward that month's spending). Added a "Partial payment" option next to the existing settle button (`app/balances.tsx`): type any amount up to what's owed, confirm, and it records a `Settlement` for exactly that — same ledger mechanism as a full settle-up, just user-chosen amount, no fake expense.

**Found and fixed while investigating a user-reported balance/drill-down mismatch** (top-level Balances showed one number, the per-member drill-down screen showed a different, larger one for the same pair): `getReceiptsForMemberPair` (feeds the drill-down list+its own total) had *separately re-derived* "does this receipt involve this pair" using only `split.enabled` logic, so it silently excluded the new non-split `createdBy`/`paidBy` contributions that the top-level total (via `computeMemberBalances`) *did* count. Now `getReceiptsForMemberPair` just filters on `computeReceiptNet(...) !== 0` — the exact same function that computes the total — so the list and its total can't drift apart again by construction. (The specific $2000 discrepancy the user saw was most likely a mix of this bug plus their own fake-receipt partial-payment workaround; ask them to delete that workaround entry and re-verify once this build is on their device.)

## Test suite — now 578 tests (was 562 at session start), 4 Jest projects, CI-gated

Same structure as before (`unit`/`component`/`performance`/`regression` projects in `jest.config.js`) — run everything with `npx jest` before committing. New tests added this session: `__tests__/dataSync.test.ts` (the new pub/sub), `__tests__/balances.test.ts` additions (createdBy/paidBy non-split net, the `getReceiptsForMemberPair` consistency guarantee), `__tests__/regression/householdsNavGuardAndMigration.test.ts` addition (legacy-budget migration marker no longer leaks into a second/later household — see below), `__tests__/auth.test.ts` additions (Apple sign-in success/cancellation/displayName-on-first-sign-in), `__tests__/phoneInvite.test.ts` updated for the rebrand.

**Known flaky, unrelated to any of this session's changes**: the `performance` project's scaling-assertion tests (`balances.perf.test.ts`, `dashboardStats.perf.test.ts`, `pdfExport.perf.test.ts` — a different one fails each run) occasionally fail on a loaded machine; always rerun before assuming a real regression.

## This session: two more real bugs found and fixed along the way

- **Settings screen rendered "Recurring" budget twice.** `ALL_CATEGORIES` (constants/categories.ts) already includes `'Recurring'`, and Settings rendered it once via `ALL_CATEGORIES.map(...)` AND once more via its own dedicated row (`RECURRING_BUDGET_KEY`) below. Fixed by filtering `'Recurring'` out of the map.
- **Guest sign-in (and any brand-new household) silently inherited a PRIOR account's old budget numbers on the same device.** `migrateLegacyBudgetsToHousehold`'s one-time-copy marker was namespaced *per household id*, so every NEW household (a second real household, or a fresh guest account) looked "unmigrated" on its first read and blindly copied in this device's old pre-multi-household budget blob — explains "guest sign-in auto-fills random category budgets." Fixed by making the marker device-wide (unsuffixed) so the legacy copy happens at most once ever, not once per household.

## Earlier sessions' state — still relevant, unchanged this session

Everything below is carried forward from before this session and wasn't touched:

- **CI/CD, three workflows**: `test.yml` (reusable, gates the other two), `release-build.yml` (push-to-main, EAS cloud, both platforms, Android blocked by exhausted Free-plan quota until Sept 1 2026), `android-build.yml` (`workflow_dispatch`, `eas build --local` on the GitHub runner itself — doesn't touch EAS cloud quota, this is the one used for every Android build this session).
- **Android R8/ProGuard**: enabled, with `plugins/withGradleJvmHeap.js` (4GB heap, avoids OOM) and `extraProguardRules` keeping `@react-native-community/datetimepicker`'s TurboModule classes (R8 was silently stripping them).
- **Android keystore**: default must stay `CQG9PRwALP` in `eas credentials --platform android` — a prior session accidentally created/selected a second wrong one (`_Echry9G8x`); re-check if a build ever gets flatly rejected as wrong-key-signed.
- **`ios/` is tracked in git** (bare workflow, not managed prebuild) — any hand-edit under `ios/` needs a normal commit; `android/` is still fully gitignored (managed prebuild, fresh every time, no drift risk).
- **Multi-household support**: `lib/AuthContext.tsx` (`memberships`, `setActiveHousehold`, `refreshMemberships`), `app/households.tsx`. Deletion is owner-only, checks unsettled balances first.
- **Dark-mode contrast**: use `theme.colors.accent`, not `theme.colors.primary` (invisible on dark surfaces).
- **Currency**: everything numeric is USD-canonical internally; render through `formatCurrency`, convert user input through `convertToUsd`/`convertFromUsd`.
- **Cloud sync 3-way chain**: `types/index.ts` → `serializeReceipt`/`CloudReceiptShape` → `upsertReceiptFromCloud`. Adding a `Receipt` field (like this session's `createdBy`) needs updates in all three, plus the SQLite schema/migration in `lib/database.ts` — this session's `createdBy` addition touched all of them; use it as the reference if adding another field.
- **New native dependencies need a fresh native build** — this session's `expo-apple-authentication`/`expo-crypto` addition required `pod install` locally (done) — OTA can't add native code, and there's no `eas update` publish step wired into CI anyway.

## Suggested first steps in a new session

1. Ask the user: has versionCode 10 been uploaded to Play Console yet? Has a new iOS build (with build number 8+) been archived/uploaded to TestFlight since the Apple-review fixes landed?
2. If an iOS build with the review fixes is confirmed live on TestFlight: help the user record/send the account-deletion screen recording and the 4.8 reply to App Review — neither has happened yet as of this handover.
3. Check EAS build credits (https://expo.dev/accounts/kmaz285/settings/billing) before relying on `release-build.yml`'s iOS job — it was near/at the monthly cap by the end of this session, causing several wasted retries. Local Xcode archive is the fallback that doesn't touch it.
4. Run `npx jest` before any further code change — fast (~8-13s), keep it passing and current.
5. If the user reports the guest-sign-in fix or the notification-refresh fix "still doesn't work," get specific repro steps on a physical device — both were fixed at the root cause this session (Firebase console config; a listener/reload race respectively) but neither was re-verified end-to-end by the user afterward as of this writing.
