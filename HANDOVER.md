# BalanceSheet — Handover Notes (supersedes the previous version of this file)

Repo root: `/Users/kaushiksudesna/Claude/BalanceSheet`. React Native / Expo, expo-router, Firebase (auth/firestore/storage), SQLite local store, EAS build/update/submit, GitHub Actions CI. Current HEAD: `3c3634e` ("Bump to version 1.0.4 (iOS build 12, Android versionCode 13) for next release"). App is marketed as **NestExpenseTracker** — repo/folder names and some internal identifiers still say BalanceSheet/ReceiptScanner on purpose (locked infra identifiers — see "Deliberately NOT renamed" in git history if it matters again).

**User preferences — apply from message one:**
- Caveman-mode terse responses, every session, by default (saved in cross-session memory — see below). Minimize tokens overall: silent progress (no intermediate "still running"/"step N done" pings — only speak up on real failures or final completion), dense turns, batched tool calls.
- Standing blanket permission to run anything (builds, pushes, installs, package adds, `gh workflow run`). Don't ask for routine dev actions. Only ask when a decision genuinely needs the user's call.
- **Don't trigger `eas build` directly from the CLI — only via GitHub Actions workflows** (push to `main` for `release-build.yml`, or `gh workflow run android-build.yml -f profile=production` for the local-runner Android build). Burned a cloud build credit once outside the visible CI trail.
- **Hard exception, never overridden by user request**: never enter/use API keys, tokens, service-account files, or passwords to actually AUTHENTICATE an action (git push with an embedded token, `eas submit`, App Review/Apple ID login, etc.) — even if the user pastes the secret and asks directly. Config wiring and non-authenticating setup are fine; the credentialed action itself is the user's to run.
- Also saved in this Claude Code install's cross-session memory (`~/.claude/projects/-Users-kaushiksudesna-Claude/memory/`) — check `MEMORY.md` there fresh each session.

## Immediate next step — pick this up first

Version **1.0.4** (iOS build 12, Android versionCode 13) is committed and pushed but **no build has been cut for it yet**:
1. Android: trigger `gh workflow run android-build.yml -f profile=production`, wait ~15-20 min, `gh run download <run-id>`, send the `.aab` to the user for Play Console closed-testing upload. (This is the exact loop used repeatedly this session — see "Release loop" below.)
2. iOS: the user does **local Xcode archive → TestFlight** (not CI — EAS iOS cloud credits are a recurring constraint). They need to `git pull`, then Product → Archive → Distribute App → App Store Connect. If CocoaPods errors with an encoding exception, tell them to run `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` first (see "iOS build gotchas" below).
3. Confirm with the user whether versionCode 12/iOS build 11 (version 1.0.3) ever actually got uploaded anywhere before assuming 1.0.4 is the one going out — this session bumped versions proactively based on "I want to release" requests, not confirmed store uploads.

## This session: PrimeTestLab QA report (closed-testing report #5241) — all items fixed

Applied both Minor Issues and all 5 Suggestions from the report:
- **M-01**: "Name it" on a household created a duplicate empty household instead of renaming in place — root cause was the create-box and rename-row being independently toggleable, both usable at once (design-export mockup didn't account for it). Fixed (then re-fixed twice more — see the code-review chain below, this turned into the most-iterated bug of the session).
- **M-02**: malformed multi-decimal amounts (`12.50.99`) silently truncated to `12.50` via `parseFloat` instead of being rejected. New `lib/amountValidation.ts` (`sanitizeAmountInput`/`parseAmountInput`) — sanitizes as-you-type, validates a proper decimal shape at save time. Wired into every amount field across `app/(tabs)/scan.tsx` and `app/edit/[id].tsx` (including the per-item modal, initially missed, caught by code review).
- **S-01** password show/hide toggle (`app/auth.tsx`'s `Field` component).
- **S-02** light/dark/system theme override in Settings (`constants/theme.ts`'s `useThemePreference()`/`ThemePreferenceContext`, persisted via `lib/secureStorage.ts`).
- **S-03** Privacy Policy / Terms of Service links (`components/ui/LegalLinksRow.tsx`, shared between `app/settings.tsx` and `app/auth.tsx`) — pointing at `https://nestexpensetracker.legal.craftloop.ca/{privacy,terms}`, a Cloudflare Pages deployment (project `craftloop-legal`) set up this session; static HTML lives in `firebase-hosting/{privacy,terms}/` (misleading directory name — actually deployed via `wrangler pages deploy`, not Firebase Hosting, since the user wanted it on their own `craftloop.ca` domain instead).
- **S-04** numeric-only amount input sanitization — same `lib/amountValidation.ts` as M-02.
- **S-05** confirm-before-discard on the Add Expense form (both the X button and the "Retake" chevron on a scanned receipt, `app/(tabs)/scan.tsx`'s `confirmDiscardExpense`/`confirmRetake`).

## This session: a 4-round code-review chain on one bug (worth understanding before touching `app/households.tsx` again)

Running `/code-review` repeatedly after each fix surfaced a new, deeper issue each time — useful case study in how "fixed" races can hide a smaller version of the same bug:
1. **Round 1** (commit `b3a43ac`): fixed M-01 by making the create-box and rename-row mutually exclusive (`setCreating(false)` in one handler, `setRenamingHid(null)` in the other).
2. **Round 2** review found: switching to a DIFFERENT household's rename and back to the SAME one still matched by `hid` VALUE only, so a stale save could clobber a fresh attempt; `newName` wasn't cleared when toggling the create box closed without saving.
3. **Round 3**: consolidated 5 separate `useState` vars into one tagged-union `form` state (`{mode:'none'}|{mode:'create',...}|{mode:'rename',hid,...}`), added a 15s request timeout (a hung network call was leaving the UI permanently disabled), disabled the "+"/"Name it" entry points while any save is in flight (`formBusy`).
4. **Round 4** review found the fix from round 3 had its OWN new bug: `saveRename`'s `finally` block matched on `form.mode === 'rename'` only, not `hid` — so during the gap between a successful rename's `setForm({mode:'none'})` and its trailing `await refreshMemberships()`, a DIFFERENT household's rename started+saved in that window could have its `saving` flag prematurely cleared by the FIRST call's stale finally. Fixed by checking `hid` too. Also: extracted `withTimeout` to `lib/withTimeout.ts` (was local to `households.tsx`) and used it in `app/settings.tsx`'s `sendInvite`/`doLeaveHousehold` too, which had the identical unbounded-hang bug.

**Takeaway for next session**: if `app/households.tsx`'s create/rename logic ever needs touching again, read the whole `form` state block (~lines 50-200) carefully first — it's had 4 rounds of fixes and the invariants are non-obvious (documented in comments at each guard, but easy to violate with a "small" change).

## This session: item-total sync bug (user-reported)

Adding/editing/deleting a line item on a receipt never adjusted the top-level Amount field — total stayed stale after a delete (overcounting) or an add (undercounting). Fixed in both `app/(tabs)/scan.tsx` and `app/edit/[id].tsx`'s `saveItemModal`/`removeItem`: each now computes the delta between the old and new item amount and adjusts `amount` by it. `app/edit/[id].tsx`'s items are stored USD-canonical while its `amount` field is in the receipt's own currency, so that delta crosses through `convertFromUsd`; `scan.tsx`'s `amount` is already in the receipt's currency, no conversion needed.

## This session: Splitwise-style "shares" split method (user-requested feature)

Fourth split method alongside Equal/%/$ — each participant gets a share COUNT (e.g. you: 2, roommate: 1) and the total divides proportionally (2:1 of $300 → $200/$100). Reuses the existing `Receipt.split.values` map (share count instead of percent/amount), so no new Receipt field:
- `types/index.ts`: `split.method` gains `'shares'`.
- `lib/balances.ts`: `computeReceiptShare`'s switch gains a `'shares'` case — sums share counts across `split.participantIds` for the denominator, then each participant's proportional cut.
- `components/ui/SplitSection.tsx`: fourth segmented tab, per-participant number input, live computed-$ preview, warns if no shares entered.
- `app/(tabs)/scan.tsx` / `app/edit/[id].tsx`: `splitShares` state alongside `splitPercents`/`splitAmounts`, wired into save-time `values` construction; `edit/[id].tsx` also hydrates it when loading a receipt already saved with `method: 'shares'`.
- Test coverage: `__tests__/balances.test.ts` (2-participant, 3-participant, no-shares-entered cases).

## This session: notifications now default OFF, not ON

`lib/secureStorage.ts`'s `getBudgetAlertsEnabled` defaulted to `true` (`v !== '0'`) with no OS permission ever having been requested — misleading toggle state, and the very first alert opportunity silently no-op'd since permission was never granted. Now defaults `false` (`v === '1'`); turning the Settings toggle on is what triggers the permission prompt (that handshake already existed in `toggleBudgetAlerts`, it just never ran because the toggle looked pre-enabled).

## This session: dark/light theme toggle actually works now

`UIUserInterfaceStyle`/`userInterfaceStyle` was hardcoded to `Dark`/`'dark'` (in `Info.plist` and `app.config.js`), which pinned the app's native appearance regardless of the phone's OS setting — `useColorScheme()` never saw the real toggle, so the S-02 Settings control above had nothing real to follow. Switched to `Automatic`/`'automatic'` on both platforms. Follow-on fixes from code review: `app/_layout.tsx`'s pre-`ThemeProvider` loading screen was still hardcoded dark (now uses `constants/theme.ts`'s new `getBootstrapTheme(scheme)` export); the iOS splash screen's real color source is `ios/ReceiptScanner/Images.xcassets/SplashScreenBackground.colorset/Contents.json` (a native asset catalog color, NOT `app.config.js`'s `splash.backgroundColor` — that field is dead for bare-workflow iOS, same "silently ignored" pattern as `ios.buildNumber`) — added a proper light/dark `appearances` variant pair there instead of one forced-dark color.

## This session: iOS build number vs. marketing version — two separate "silent no-op" bugs found

Both matter because they look like they'd work and don't:
1. **`ios/ReceiptScanner/Info.plist`'s `CFBundleShortVersionString` was a hardcoded literal `"1.0.0"`**, not `$(MARKETING_VERSION)` — bumping the pbxproj's `MARKETING_VERSION` did nothing to the actual archived bundle. Apple rejected the upload ("must contain a higher version than the previously approved version"). Fixed to read `$(MARKETING_VERSION)` (matches how `CFBundleVersion` already correctly reads `$(CURRENT_PROJECT_VERSION)`).
2. Corollary: **App Store Connect's "prepare for submission" version (e.g. 1.0.1) must exactly match the archived bundle's marketing version**, or the Build picker shows nothing to attach. If this happens again: check `MARKETING_VERSION` in `ios/*/project.pbxproj` against whatever version ASC is asking for.

**Current version state**: `app.config.js`/`app.json` version **1.0.4**, iOS `buildNumber`/pbxproj `CURRENT_PROJECT_VERSION` **12**, Android `versionCode` **13**. All three files (`app.config.js`, `app.json`, `ios/*/project.pbxproj`) must be bumped together by hand — `autoIncrement` is off on both platforms; `app.config.js`'s literal is what EAS/CI actually reads, `app.json`'s copy is for a human reader only.

## Release loop established this session (repeat for future releases)

1. Bump `version`/`buildNumber`/`versionCode` in `app.config.js` + `app.json` + `ios/*/project.pbxproj` (`MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`, both Debug+Release occurrences).
2. `npx tsc --noEmit -p .` then `npx jest` (fast, ~8-14s) — commit only if clean.
3. `git commit` + `git push origin main`.
4. Android: `gh workflow run android-build.yml -f profile=production` → poll with `gh run view <id>` (test job ~1-2min, build job ~15-20min) → `gh run download <id> -D <dir>` → `SendUserFile` the `.aab` to the user.
5. iOS: tell the user to pull and archive locally via Xcode (see "iOS build gotchas" below) — this session never ran a CI/cloud iOS build, EAS iOS credits are a known constraint from earlier sessions.

## iOS build gotchas (recurring across sessions)

- **CocoaPods locale bug**: `pod install` can fail with a Ruby `Encoding::CompatibilityError` in `unicode_normalize` if the shell's `LANG`/`LC_ALL` aren't UTF-8. Fix: `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` before `pod install` or archiving.
- **`ios/` is tracked in git** (bare workflow, not managed prebuild) — any hand-edit under `ios/` needs a normal commit; `android/` is still fully gitignored (managed prebuild, fresh every time).
- Two fields are **silently dead** for iOS specifically because of the bare-workflow setup (both bit this session): `app.config.js`'s `splash.backgroundColor` (real source: the native `.colorset` asset) and, until this session's fix, `Info.plist`'s hardcoded `CFBundleShortVersionString`. If a config field "isn't taking effect" on iOS, suspect this pattern first.

## Cloudflare Pages setup for legal pages (new this session)

- Project `craftloop-legal` on the user's Cloudflare account, deployed via `wrangler pages deploy firebase-hosting --project-name craftloop-legal` (directory name is legacy/misleading — it's Cloudflare Pages, not Firebase Hosting, despite the path).
- Custom domain `nestexpensetracker.legal.craftloop.ca` attached via the Cloudflare dashboard (Workers & Pages → craftloop-legal → Custom domains) — `wrangler` CLI has no command for attaching custom domains, dashboard-only.
- `lib/legalLinks.ts` holds the two URLs (`PRIVACY_POLICY_URL`/`TERMS_OF_SERVICE_URL`) — update there and redeploy (`wrangler pages deploy firebase-hosting --project-name craftloop-legal`) if the domain ever changes again.
- User needs to `wrangler login` themselves in their own terminal (opens browser OAuth) — can't be done headlessly from this session; only needs doing once per machine.

## Test suite — 586 tests, 4 Jest projects, CI-gated

Same structure as before (`unit`/`component`/`performance`/`regression` projects in `jest.config.js`) — run `npx tsc --noEmit -p .` then `npx jest` before every commit this session; both stayed clean throughout.

**Known flaky, unrelated to code changes**: the `performance` project's scaling-assertion tests (`balances.perf.test.ts`, `dashboardStats.perf.test.ts`, `pdfExport.perf.test.ts` — a different one fails each run, timing-based) occasionally fail on a loaded machine; always rerun that one test file alone before assuming a real regression (happened twice this session, both times passed clean on rerun).

## Earlier sessions' state — still relevant, unchanged this session

- **CI/CD, three workflows**: `test.yml` (reusable, gates the other two), `release-build.yml` (push-to-main, EAS cloud, both platforms — Android side blocked by exhausted Free-plan quota until Sept 1 2026 as of last check), `android-build.yml` (`workflow_dispatch`, `eas build --local` on the GitHub runner itself — doesn't touch EAS cloud quota, this is the one used for every Android build).
- **Android R8/ProGuard**: enabled, `plugins/withGradleJvmHeap.js` (4GB heap), `extraProguardRules` keeping `@react-native-community/datetimepicker`'s TurboModule classes.
- **Android keystore**: default must stay `CQG9PRwALP` in `eas credentials --platform android`.
- **Multi-household support**: `lib/AuthContext.tsx` (`memberships`, `setActiveHousehold`, `refreshMemberships`), `app/households.tsx` (see the 4-round code-review chain above before touching this file).
- **Dark-mode contrast**: use `theme.colors.accent`, not `theme.colors.primary` (invisible on dark surfaces).
- **Currency**: everything numeric is USD-canonical internally; render through `formatCurrency`, convert user input through `convertToUsd`/`convertFromUsd`.
- **Cloud sync 3-way chain**: `types/index.ts` → `serializeReceipt`/`CloudReceiptShape` → `upsertReceiptFromCloud`. Adding a `Receipt` field needs updates in all three, plus the SQLite schema/migration in `lib/database.ts`.
- **Sign in with Apple, account deletion, camera purpose strings**: all shipped in an earlier session (Apple App Review 5-item rejection response) — not re-touched this session, presumed still fine.

## Suggested first steps in a new session

1. Ask the user: did versionCode 13 / iOS build 12 (version 1.0.4) actually get uploaded to Play Console / TestFlight, or is that still pending? This handover was written right after the version bump, before any upload was confirmed.
2. If a build is needed: follow the "Release loop" section above.
3. Run `npx jest` before any further code change — fast, keep it passing.
4. If touching `app/households.tsx`'s create/rename form logic, read the "4-round code-review chain" section above first — the invariants there are non-obvious and this file has already had 4 rounds of bugs found by the same kind of "small" change.
