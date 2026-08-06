# BalanceSheet — Handover Notes (supersedes the previous version of this file)

Repo root: `/Users/kaushiksudesna/Claude/BalanceSheet`. React Native / Expo, expo-router, Firebase (auth/firestore/storage), SQLite local store, EAS build/update/submit. Current HEAD: `663569d` ("Fix iOS/Android release builds: set EAS_NO_VCS so gitignored files upload").

**User preferences — apply from message one:**
- Caveman-mode terse responses, every session, by default (saved in cross-session memory — see below). Minimize tokens overall: silent progress (no intermediate "still running"/"step N done" pings — only speak up on real failures or final completion), dense turns, batched tool calls.
- Standing blanket permission to run anything (builds, pushes, installs, package adds). Don't ask for routine dev actions. Only ask when a decision genuinely needs the user's call (e.g. investment-level tradeoffs, ambiguous bug symptoms you can't reproduce without a device).
- **Hard exception, never overridden by user request**: never enter/use API keys, tokens, service-account files, or passwords to actually AUTHENTICATE an action (git push with an embedded token, `eas submit`, typing App Review sign-in credentials, etc.) — even when the user pastes the secret directly and explicitly asks. Config wiring (referencing a key's file path in `eas.json`) and non-authenticating setup are fine; the actual credentialed action itself is the user's to run.
- Also saved in this Claude Code install's cross-session memory (`~/.claude/projects/-Users-kaushiksudesna-Claude/memory/`) — check `MEMORY.md` there fresh each session; it indexes feedback/project/user memories including this app's state, token-efficiency preferences, and a recurring token-usage-report deliverable (`project_token_report_20260806.md`) the user asks for on demand.

## Immediate next step — pick this up first

A `release-build.yml` run was in flight when this handover was written (both iOS and Android jobs, triggered by the `EAS_NO_VCS` fix below). **Check its result first** — `gh run list --workflow=release-build.yml --limit 1`, then `gh run view <id>`:
- If iOS succeeded: this is the **first successful iOS build of the whole project** as far as this history shows. Auto-submit should have pushed it to App Store Connect/TestFlight — verify it actually landed there, then move on to the iOS App Store readiness items (screenshots, App Review sign-in creds, DSA declaration, "Add for Review") which haven't been touched in a long time.
- If iOS still failed: read the actual Xcode-detected error from the job log (`gh run view --job=<ios-job-id> --log | grep -A5 "iOS build failed"`) — don't assume it's one of the three already-fixed causes below; this session fixed three distinct, unrelated root causes for iOS CI in a row (bare-workflow runtimeVersion policy, wrong GoogleService-Info.plist path, then EAS_NO_VCS/git-archiving), so a fourth is plausible.
- Android's own `release-build.yml` job will still fail on the pre-existing EAS Free-plan quota issue (see below) — that's expected, ignore it. A working Android build for closed testing was already produced this session via `android-build.yml`'s `production` profile (versionCode 8, artifact `receipt-scanner-production-f3f5c0537332772804a19df402e44ada43180d3a`) — **confirm whether the user actually uploaded that to Play Console** before assuming versionCode 8 is live.

## CI/CD — three workflows now, know which does what

- **`.github/workflows/test.yml`** — new this session. Reusable (`workflow_call` only, no standalone trigger) — runs the full Jest suite (`npx jest --ci`, all 4 projects) + the bundle-size check. Both other workflows below call it as a `test` job and gate their build jobs on it via `needs: test`, so a broken test suite blocks the actual build/release instead of just failing a separate, easy-to-ignore check.
- **`.github/workflows/release-build.yml`** — triggers on push to `main`. Two jobs (`android`, `ios`), each running `eas build --platform <x> --profile production --non-interactive --auto-submit` on **EAS's own cloud builders**, gated on the `test` job. Android is currently blocked by the exhausted Free-plan quota (see below). iOS was blocked by three separate bugs, all fixed this session (see "iOS CI" below) — check the Immediate-next-step section above for current status.
- **`.github/workflows/android-build.yml`** — `workflow_dispatch` (manual, pick `preview`/`production`/`development`) or auto on push to `main`/`feature/**`/`fix/**`, also gated on `test`. Runs `eas build --local`, which compiles Gradle **on the GitHub runner itself** — does not touch the EAS cloud quota. `production` profile emits a `.aab`; other profiles emit a sideloadable `.apk`. Trigger with `gh workflow run android-build.yml -f profile=production`, then download the artifact from the run.
- Neither `release-build.yml` nor `android-build.yml` auto-triggers on an **empty** git commit (GitHub's path-filter skips zero-diff pushes) — edit a trivial comment or use `gh run rerun <run-id>` to force one (reruns replay the ORIGINAL commit, not current `main`).

## Test suite — new this session, 4 Jest projects, CI-gated

`jest.config.js` defines 4 projects, all runnable together via plain `npx jest` (56 suites / 562 tests as of this writing):

- **`unit`** (`__tests__/*.test.ts`) — pure-logic tests for `lib/*.ts`. ts-jest, Node env.
- **`component`** (`__tests__/components/*.test.tsx`) — React screen rendering via `@testing-library/react-native`. `jest-expo` preset (RN runtime).
- **`performance`** (`__tests__/performance/*.perf.test.ts`) — benchmarks with an explicit 1x-vs-8x scaling assertion per hot path (the real O(n²) tripwire, not just an absolute-time threshold) covering parser/categorizer/dashboardStats/pdfExport/recurring/balances. `scripts/check-bundle-size.js` + `scripts/bundle-size-baseline.json` track JS bundle size (currently 5.64MB baseline, +10% fail threshold) — run via `npm run test:bundle-size`.
- **`regression`** (`__tests__/regression/*.test.{ts,tsx}`) — one test per historically-fixed bug mined from git history and the previous handover (Edit Profile hydration, SecureStore colon-key charset, Recurring-category double-counting, per-household alert throttle, receipt line items, dashboard tax pro-rata, PDF detection via require vs NativeModules, households nav-guard whitelist).

Run everything before committing: `npx jest`. Per-project: `npm run test:unit` / `test:component` / `test:perf` / `test:regression`. **One known flaky test**: `__tests__/performance/balances.perf.test.ts`'s scaling assertion occasionally fails on a loaded machine (timing-sensitive `expect(largeMs).toBeLessThan(...)`) — rerun before assuming a real regression.

**When adding a new lib/ function or screen, add its test alongside it** — this suite is meant to stay current, not be a one-time snapshot.

## Android build hardening — R8/ProGuard enabled, with real fallout

`expo-build-properties`'s `android.enableProguardInReleaseBuilds`/`enableShrinkResourcesInReleaseBuilds` are now `true` (Play Console had flagged "App optimization: Low"). Two real problems this caused, both fixed:

1. **Gradle OOM on the CI runner** — R8 needs more heap than the runner's 2GB default. Fixed via a custom config plugin, `plugins/withGradleJvmHeap.js`, which sets `org.gradle.jvmargs` to a 4GB heap in `gradle.properties` (uses `@expo/config-plugins`' `withGradleProperties`).
2. **R8 silently stripped `@react-native-community/datetimepicker`'s native module** — it ships no ProGuard consumer rules of its own (unlike Expo's own modules, which are covered by `expo-modules-core`'s bundled rules), and RN's bundled `proguard-rules.pro` doesn't keep the TurboModule marker interface this library's spec classes implement. Symptom was silent: no crash, the calendar/date picker on the recurring-expense screen just never opened. Fixed via `android.extraProguardRules` in `app.config.js` (see the `expo-build-properties` plugin block) — keeps the library's package plus TurboModule/ReactPackage implementers generally. **If a future native module mysteriously stops working after this point with no error, suspect R8 stripping first** — check for a similar missing keep rule before assuming a JS bug.

Also this session: `compileSdkVersion`/`targetSdkVersion`/`buildToolsVersion` bumped to **36** (Google Play's Aug 31 2026 deadline for targeting Android 16).

## iOS CI — three separate, now-fixed root causes (verify the current run before trusting any of this)

No iOS build had actually succeeded in a long time before this session — every attempt failed before reaching a usable state, for three unrelated reasons found and fixed in sequence:

1. **Bare-workflow `runtimeVersion` policy rejected outright.** `ios/` is a real checked-in Xcode project now (see below), which makes EAS treat iOS as "bare workflow" — where the top-level policy-based `runtimeVersion: { policy: 'appVersion' }` is rejected with `"You're currently using the bare workflow, where runtime version policies are not supported."` **This was failing every iOS build before it ever reached Xcode.** Fixed with a literal `ios.runtimeVersion: '1.0.0'` override in `app.config.js` (Android keeps the policy-based default — its native project isn't checked in, still EAS's fresh-every-time prebuild).
2. **`GoogleService-Info.plist` staged at the wrong path.** `release-build.yml`'s "Stage gitignored files" step wrote it to repo root; `project.pbxproj` references it at the fixed path `ios/ReceiptScanner/GoogleService-Info.plist` (bare workflow, not Expo prebuild-managed). Fixed by writing it to that exact path in the workflow.
3. **`eas build`'s default git-archiving mode excluded the file anyway.** Even after fix #2 wrote the file to the correct path on the GitHub runner, `eas build` archives the project via **git's tracked-file list by default** — and the plist is gitignored, so it never made it into the uploaded archive despite existing locally. Xcode on EAS's remote builder reported `"Build input file cannot be found"` for a file that demonstrably existed on the runner moments earlier. `android-build.yml` had already worked around this identical behavior with `EAS_NO_VCS: '1'`; `release-build.yml` never had it. Fixed by adding `EAS_NO_VCS: '1'` to both the iOS and Android EAS-build steps in `release-build.yml`.

Also fixed: `@react-native-community/datetimepicker`'s CocoaPod had **never actually been installed** — confirmed by running `pod install` locally and watching it add `RNDateTimePicker (8.2.0)` for the first time (it wasn't in the committed `Podfile.lock` at all). This was a second, independent reason the recurring-expense date picker didn't open on iOS (unrelated to Android's R8 cause — iOS doesn't use R8/ProGuard). Podfile.lock + the auto-updated `project.pbxproj` are committed. Also added `*.xcworkspace` to `ios/.gitignore` (the CocoaPods-regenerated top-level workspace was showing up untracked; the existing `project.xcworkspace` line only matched the nested one inside `.xcodeproj`).

**A real gotcha discovered but not yet acted on**: since `ios/` is bare workflow, `ios.buildNumber` in `app.config.js`/`app.json` is **also ignored**, same as `ios.bundleIdentifier` (EAS logs this explicitly for bundleIdentifier; buildNumber behaves the same way but doesn't log it). The actual build number Xcode uses comes from `CURRENT_PROJECT_VERSION` in `ios/NextExpenseTracker.xcodeproj/project.pbxproj`, currently **`5`** — NOT the `'6'` that `app.config.js`/`app.json` claim. If the in-flight/most-recent iOS build succeeded using build number 5, **bump `CURRENT_PROJECT_VERSION` directly in `project.pbxproj`** (both `Debug` and `Release` build configs — two occurrences) before the next iOS submission, since App Store Connect will reject a duplicate. Don't bother bumping the dead `app.config.js`/`app.json` `buildNumber` field for iOS — it does nothing under bare workflow; only leave it in sync for a human reader.

Separately, unrelated to CI: iOS App Store readiness (screenshots, App Review sign-in credentials, Digital Services Act declaration, "Add for Review" click) hasn't been touched in a long time — treat as still pending.

## Android version numbering — fully manual, `autoIncrement` is OFF

`eas.json`'s `build.production.autoIncrement` was `true` and silently broken (recomputed versionCode every build regardless of committed state, repeatedly colliding with what's live on Play Console). Now `false`; bump manually:

1. Bump `android.versionCode` in **both** `app.config.js` (the literal actually used at build time) and `app.json` (kept in sync for a human reader only).
2. Verify with `npx expo config --json --type public | node -e "..."` before triggering a build — app.config.js overrides app.json.
3. **Current value: `versionCode: 8`.** versionCode 6 and 7 were built earlier this session; unclear whether either was ever actually uploaded to Play Console before superseding fixes landed — don't assume either is live.
4. For iOS, see the buildNumber gotcha above — it's a completely different mechanism (native `project.pbxproj`, not app.config.js) since `ios/` went bare.

## Android EAS cloud quota — still exhausted, resets Sept 1 2026

Confirmed via the exact error EAS returns (not a guess): the Free-plan Android cloud build quota is exhausted for the month. `release-build.yml`'s Android job will keep failing with this exact error until it resets or the plan is upgraded (https://expo.dev/accounts/kmaz285/settings/billing). Use `android-build.yml`'s local-build path in the meantime — it doesn't touch the cloud quota at all.

## Android keystore — a real incident from an earlier session, resolved, know the shape of it

An `eas credentials --platform android` visit once ended up creating/selecting a **second, wrong keystore** (`_Echry9G8x`) as the account's default, mismatched with what's live on Play (`CQG9PRwALP`) — a build signed with the wrong key gets flatly rejected by Google. Fixed by re-selecting `CQG9PRwALP` as default in `eas credentials --platform android` → Build Credentials. If that exact wrong-key error ever recurs, check the *default* keystore first.

## `ios/` is tracked in git — was silently gitignored before, causing repeat drift

Fixed in an earlier session: removed the blanket `ios/` line from the root `.gitignore`. The nested `ios/.gitignore` still correctly excludes `Pods/`, `build/`, and machine-local artifacts. **Any hand-edit under `ios/` (Info.plist, entitlements, project.pbxproj) needs a normal commit now** — it won't be silently discarded, but it also won't auto-update from `app.config.js` unless someone runs `expo prebuild` (and several `ios.*` app.config.js fields — bundleIdentifier, buildNumber — are now flatly ignored in favor of the native project's own values; see the iOS CI section above).

`android/` is still fully gitignored — no native folder checked in, EAS's fresh-every-time prebuild handles it, no equivalent drift risk.

## Bi-weekly recurring frequency (this session)

Added alongside weekly/monthly/yearly: `lib/recurring.ts`'s `advance()` now takes `'weekly' | 'biweekly' | 'monthly' | 'yearly'`, with UI pickers in `app/(tabs)/scan.tsx` and `app/edit/[id].tsx`, label map in `app/recurring.tsx`, and the type union in `types/index.ts`. If you add another frequency, grep for `'weekly'` across those four files — there's no single source of truth for the picker list.

## Duplicate budget-alert notifications — fixed, a real concurrency race

`checkBudgetsAndNotify` (`lib/notifications.ts`) had a read-then-write race: it read `lastBudgetAlertDate`, computed a summary, then wrote the updated date at the end — all async. If `useFocusEffect` (Home's `app/(tabs)/index.tsx`) fired more than once in quick succession (e.g. rapid tab switching), each concurrent call read the same stale "not sent today" state before any of them wrote it back, so all of them passed the once-per-day throttle and each fired its own notification — the exact "same alert 3 times" symptom reported. Fixed with a synchronous in-memory `Set`-based in-flight guard (`budgetCheckInFlight`) that short-circuits overlapping calls — a sync check-and-add has no `await` in between, so it can't race the way the storage read/write did.

## Shared-expense/settle-up push notifications now deep-link + auto-refresh

Two related fixes, both in this session:
- Pushes from `notifyNewSharedExpense`/`notifySettleUp` now carry `data: { screen: 'home' }`. `app/_layout.tsx` has a notification-response handler (`Notifications.addNotificationResponseReceivedListener` + `getLastNotificationResponseAsync` for cold start) that navigates to `/(tabs)` (Home) on tap. Originally routed to Balances — changed to Home per explicit request.
- Both Home (`app/(tabs)/index.tsx`) and Balances (`app/balances.tsx`) now have an `AppState` listener that reloads data on the `background`/`inactive` → `active` transition, not just `useFocusEffect` (navigation focus). Without this, if the screen was already the focused one when the app got backgrounded, resuming via a notification tap (or just switching back to the app) is an AppState change with no navigation event, so the reload never fired and the screen showed stale data despite "opening."

## Notifications — earlier-session fixes, still relevant

- `computeBudgetStatusSummary` groups spend by category but treats the "Recurring" pseudo-budget (`RECURRING_BUDGET_KEY` in `lib/recurring.ts`) as a separate axis — has a guard against double-counting a receipt whose category is literally `"Recurring"`.
- The daily local-check throttle (`lastBudgetAlertDate`) is namespaced per household — a user with 2+ households doesn't have today's alert slot silently consumed by whichever household got checked first.
- `notifyNewExpenseToHousehold` pushes every OTHER household member on any new expense (not just split ones); split participants get the more specific `notifyNewSharedExpense` push instead and are excluded from the general one.

## Categories — Electricity + Recurring (earlier session, still relevant)

- **Electricity**: normal category. Several category-color maps use `as Record<Category, string>` type assertions that bypass TypeScript's completeness checking — grep for `Groceries:` to find every category-keyed map if adding another category.
- **Recurring**: selectable as a category; picking it auto-enables "Repeat this expense." Has a guard (`r.category !== RECURRING_BUDGET_KEY`) in both `app/(tabs)/index.tsx` and `lib/notifications.ts` against double-counting.

## Multi-household support (earlier session, still the biggest feature — unchanged this session)

Users can belong to multiple households, switch, create, and (owners only) delete. Data model: Firestore `users/{uid}/memberships/{hid}`, `households/{hid}.name`, SQLite `household_id` columns, per-household-namespaced SecureStore budgets (dots, not colons — SecureStore keys only allow `[A-Za-z0-9._-]`). Deletion is owner-only, reachable only from the Households screen, checks unsettled balances first. See `lib/AuthContext.tsx` (`memberships`, `setActiveHousehold`, `refreshMemberships`, `editInProgress`) and `app/households.tsx`.

## Earlier sessions' real bugs/patterns (still relevant)

- **Dark-mode contrast**: `t.colors.primary` (dark navy) is invisible on dark backgrounds — use `t.colors.accent`.
- **Currency**: everything numeric is USD-canonical; render through `formatCurrency`.
- **Cloud sync 3-way chain**: `types/index.ts` → `serializeReceipt`/`CloudReceiptShape` → `upsertReceiptFromCloud`. Adding a `Receipt` field to the type and local DB but forgetting one of these has happened repeatedly.
- **New native dependencies always need a fresh native build** — OTA can't add native code, and this project has no `eas update` publish step wired into CI (an OTA `updates.url` IS configured, but nothing calls `eas update` to publish through it).
- **EAS build image**: iOS build profile needs `"image": "latest"` in `eas.json` or Apple rejects the upload after the fact, not at build time.

## Suggested first steps in a new session

1. Check the in-flight/most-recent `release-build.yml` run's result (see "Immediate next step" above) — this determines whether iOS CI genuinely works now.
2. If iOS succeeded: bump `CURRENT_PROJECT_VERSION` in `project.pbxproj` before the *next* iOS build (see the buildNumber gotcha above), and pick up iOS App Store readiness (screenshots, sign-in creds, DSA, "Add for Review").
3. Confirm whether versionCode 8's Android `.aab` was actually uploaded to Play Console for closed testing.
4. Run `npx jest` before any further code change — the suite is fast (~8s) and now CI-gates every build; keep it passing and keep it current as you add features.
5. `.gitignore`-untracked `firebase-hosting/privacy/` and `firebase-hosting/support/` directories were tracked and pushed this session (`70aaa9b`) — no longer an open item.
