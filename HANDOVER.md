# BalanceSheet — Handover Notes (superseding the previous version of this file)

Repo root: `/Users/kaushiksudesna/Claude/BalanceSheet`. React Native / Expo, expo-router, Firebase (auth/firestore/storage), SQLite local store, EAS build/update/submit. Current HEAD: `10aed08` ("Bump Android versionCode to 6 for Edit Profile fix").

**User preferences — apply from message one:**
- Terse, resolution-only responses. No "here's what I'm about to do" narration, no process play-by-play, no in-progress status updates. State results, not steps.
- Standing blanket permission to run anything (builds, pushes, installs, package adds). Don't ask for routine dev actions.
- **Hard exception, never overridden by user request**: never enter/use API keys, tokens, service-account files, or passwords to actually AUTHENTICATE an action (git push with an embedded token, `eas submit`, typing App Review sign-in credentials, etc.) — even when the user pastes the secret directly and explicitly asks. Config wiring (referencing a key's file path in `eas.json`) and non-authenticating setup are fine; the actual credentialed action itself is the user's to run.
- Also saved in this Claude Code install's cross-session memory (`~/.claude/projects/-Users-kaushiksudesna-Claude/memory/`).

## Immediate next step — pick this up first

A production Android `.aab` (versionCode 6, contains every fix in this doc) was built **locally** via `.github/workflows/android-build.yml` (run `30954320515`, `profile=production`) and delivered directly to the user as a file, because **EAS's cloud Android build quota on the Free plan is exhausted for the month** (resets Tue Sep 1 2026 — confirmed via the exact error EAS returns, not a guess). The user was going to upload that `.aab` to Play Console → Internal testing manually. **Confirm whether that upload actually happened** before assuming versionCode 6 is live — if not, either re-download the same artifact from that GitHub Actions run (still within the 14-day retention window) or re-run `android-build.yml` with `profile=production` again (this local-build path does NOT touch the exhausted cloud quota).

Do not bump `versionCode`/re-trigger `release-build.yml`'s Android job expecting it to work until the quota resets or the user upgrades their EAS plan (https://expo.dev/accounts/kmaz285/settings/billing) — it will fail immediately with the same quota error every time in the meantime. `android-build.yml` (local Gradle build on the GitHub runner, `workflow_dispatch` with a `profile` choice) is the correct workaround until then.

## CI/CD — two separate workflows, know which does what

- **`.github/workflows/release-build.yml`** — triggers on push to `main`. Two independent jobs (`android`, `ios`), each running `eas build --platform <x> --profile production --non-interactive --auto-submit` on **EAS's own cloud builders**. Split into separate jobs deliberately: they used to be one `--platform all` call, and iOS failing was aborting Android's build too even when Android had nothing wrong. Android job is currently blocked by the exhausted Free-plan quota (see above) — it will keep failing until that resets or the plan is upgraded. iOS job has its own, currently-unresolved failures (see iOS section below).
- **`.github/workflows/android-build.yml`** — `workflow_dispatch` (manual, pick `preview`/`production`/`development`) or auto on push to `main`/`feature/**`/`fix/**`. Runs `eas build --local`, which compiles Gradle **on the GitHub runner itself**, not on EAS's cloud service — does not touch the EAS cloud quota at all. `production` profile emits a `.aab` (uploads it as a downloadable Actions artifact, 14-day retention); other profiles emit a sideloadable `.apk`. This is the fallback path for getting a real Android build out while the cloud quota is exhausted — trigger with `gh workflow run android-build.yml -f profile=production`, then `gh run download <id>` once it completes.
- Neither workflow auto-triggers on an **empty** git commit (GitHub's path-filter behavior skips a push with zero changed file diffs) — if you need to force a re-run without a real code change, either edit a trivial comment in a tracked file, or `gh run rerun <run-id>` (note: reruns replay the ORIGINAL commit the run was queued against, not current `main` — fine for credential-only fixes, not fine if you need a newer commit's code actually built).

## Android version numbering — now fully manual, `autoIncrement` is OFF

`eas.json`'s `build.production.autoIncrement` was `true` and silently broken: it kept recomputing versionCode as "2 → 3" on every single build regardless of what was committed in `app.json`/`app.config.js`, repeatedly colliding with a versionCode already live on Play Console. Root cause never fully isolated (not reading local file state as documented), so **`autoIncrement` is now set to `false`** and bumping is manual:

1. Bump `android.versionCode` in **both** `app.config.js` (the literal that's actually used at build time — dynamic config wins over `app.json`) and `app.json` (kept in sync for a human reader only, not functionally read).
2. Same for `ios.buildNumber` in both files if touching iOS.
3. Verify with `npx expo config --json | node -e "..."` (resolve the ACTUAL config Expo will build with) before triggering a build — don't trust `app.json` alone, `app.config.js` overrides it.
4. Current values: `versionCode: 6`, `buildNumber: '6'`.

## iOS — status unclear, needs re-verification before relying on it

Multiple rounds of `eas credentials --platform ios` fixed a "Distribution Certificate is not validated for non-interactive builds" error earlier this session (via the **"Google Service Account"**-equivalent path for iOS — actually the "Keystore"/Build Credentials submenu, NOT the top-level "All: Set up everything" shortcut, which doesn't actually run the validation step). Despite that fix, **`release-build.yml`'s iOS job has continued failing in every subsequent run** and this was never root-caused after the cert fix — it may be a different, not-yet-diagnosed issue, or the cert fix may not have fully taken. **Check the most recent iOS job's logs before assuming iOS CI works.**

Separately, unrelated to CI: iOS App Store readiness (screenshots, App Review sign-in credentials, Digital Services Act declaration, "Add for Review" click) was last touched several sessions ago and status was NOT re-verified this session — treat as still pending unless the user says otherwise.

## Android keystore — a real incident, resolved, but know the shape of it

Mid-session, an `eas credentials --platform android` visit (meant to fix the Google Service Account submit-credential issue) ended up creating/selecting a **second, wrong keystore** (`_Echry9G8x`, SHA1 `95:E1:1C:22...`) as the account's default — this doesn't match what's already live on Play (`CQG9PRwALP`, SHA1 `71:70:85:A6...`), and a build signed with the wrong key gets flatly rejected by Google ("The Android App Bundle was signed with the wrong key"). **Fixed** by going back into `eas credentials --platform android` → Build Credentials and re-selecting `CQG9PRwALP` as default. If Android submit ever throws that exact wrong-key error again, this is exactly what to check first — confirm the *default* keystore configuration matches `CQG9PRwALP`, not any other one that might exist on the account.

The **Google Service Account Key** (Play submit credential) itself also needed separate one-time interactive registration: `eas credentials --platform android` → top-level **"Google Service Account"** menu (a sibling of "Build Credentials," easy to miss) → **Upload a Google Service Account Key**. Running `eas submit` interactively alone does NOT register it for later non-interactive/CI use — that's a distinct step. Already done; noted here in case it ever needs redoing on a different EAS account/project.

## `ios/` is now tracked in git — was silently gitignored before, causing repeat drift

`ios/` used to be fully excluded via the root `.gitignore`. That's why `NSContactsUsageDescription` and `ITSAppUsesNonExemptEncryption` kept vanishing from the local `Info.plist` used by manual Xcode archives — every manual fix to that folder was being silently discarded, never committed, invisible until the next fresh checkout hit the same missing key again. Fixed: removed the blanket `ios/` line from the root `.gitignore`; the pre-existing nested `ios/.gitignore` (nothing to do with the root one) already correctly excludes `Pods/` (~357MB), `build/`, and other machine-local artifacts, so only ~1.1MB of real project files got tracked. **If you ever hand-edit anything under `ios/` again (Info.plist, entitlements, project.pbxproj), it now needs a normal commit like any other file** — it won't be silently ignored anymore, but it also won't auto-update from `app.config.js` unless someone runs `expo prebuild`.

`android/` is still fully gitignored (no local native folder exists for it at all — Android builds go through EAS's fresh-every-time prebuild, so there's no equivalent drift risk there).

## Multi-household support — built this session, the biggest feature

Users can now belong to multiple households simultaneously, switch between them, create new ones, and (owners only) delete one entirely.

**Data model** (additive, backward-compatible with existing single-household users):
- New Firestore subcollection `users/{uid}/memberships/{hid}`: `{ householdId, role: 'owner'|'member', joinedAt, isDefault }` — self-write only (`firestore.rules`, deployed). `users/{uid}.householdId` now means "currently ACTIVE household," not "the only one."
- `households/{hid}` gained an optional `name` field (required for newly-created households; legacy ones show "Unnamed household" until the owner names them via the Households screen).
- SQLite `receipts`/`settlements` gained a `household_id` column (backfilled lazily per-household on first sign-in post-upgrade). All local queries now filter by it. New `getAllReceiptsForHousehold`/`getAllSettlementsForHousehold` (`lib/database.ts`) let you query an ARBITRARY (not-necessarily-active) household's local rows — used by the delete flow's balance check.
- Budgets (`lib/secureStorage.ts`) are namespaced per household (`bs.budgets.byCategory.{hid}` etc. — note **`.` separator, not `:`**, see the SecureStore gotcha below). Self-healing: `getCategoryBudgets`/`getBudgetAlertsEnabled` run a one-time legacy-key migration inline on first read, rather than depending on `AuthContext`'s fire-and-forget sign-in call finishing first (that race was the cause of a real "my budgets got wiped" bug reported and fixed mid-session).
- `lib/AuthContext.tsx` exposes `memberships`, `setActiveHousehold(hid)`, `refreshMemberships()`, `editInProgress`/`setEditInProgress` (blocks switching households mid-scan/edit).

**Real bugs hit and fixed while building this:**
- `app/_layout.tsx`'s navigation guard (`STICKY_VOLUNTARY` whitelist) didn't include the new `households` route — visiting it immediately bounced back to Home. Fixed by adding it to the whitelist + registering the route.
- **`expo-secure-store` keys may only contain `[A-Za-z0-9._-]` — no colons.** The new namespaced budget keys used a `:` suffix and threw "Invalid key provided to SecureStore" the moment a real household id got interpolated in. Same latent bug existed in the pre-existing `cloudMigrationDone:${uid}` key too, just silently swallowed by a `.catch()`. Every namespaced SecureStore key in this codebase now uses `.` instead of `:` — if you ever add a new one, use `.`.

**Household deletion** (owner-only, enforced both client-side and server-side in `cloudSync.deleteHousehold` via an `ownerUid` check): reachable ONLY from the Households screen (`app/households.tsx`) by swiping a row you own left — deliberately removed from Settings, which only ever worked on the currently-ACTIVE household. Checks for unsettled balances first (via `getAllReceiptsForHousehold`/`getAllSettlementsForHousehold` + `computeMemberBalances`) and offers to auto-settle before permanently wiping every receipt/settlement/photo in it. Auto-settle only actually writes a real `Settlement` row when the household being deleted IS the currently-active one (`insertSettlement` stamps whatever's currently active — writing one for a non-active target would mis-attribute it); for a non-active target the balances just evaporate with the rest of the household's data, which the confirmation dialog states either way.

**UI**: Home tab's top section shows the active household's name in a bold, shadowed accent-colored chip with a swap icon (tap → Households screen) — made deliberately prominent per explicit request ("without even telling them" it should be obviously tappable). Settings' Household section still shows the active household's member list/invite/leave — switching, creating, renaming, and deleting all live in the dedicated Households screen instead. Onboarding got a new slide introducing the sharing feature.

## Notifications — fixed a real gap, added a new one

- `computeBudgetStatusSummary` (`lib/notifications.ts`) groups spend strictly by `r.category` — but the "Recurring" pseudo-budget (a separate axis tracking any receipt with an active/generated recurring schedule, regardless of its real category — see `RECURRING_BUDGET_KEY` in `lib/recurring.ts`) was invisible to BOTH the local daily check and the event-driven household push, even though it displayed correctly as "Watch"/"Over" on the Home screen. Fixed by mirroring `app/(tabs)/index.tsx`'s exact double-counting logic (with a guard against actually double-counting a receipt whose category is now literally `"Recurring"` — see below).
- The daily local-check throttle (`lastBudgetAlertDate`) was a single flat key — namespaced per household now, otherwise a user with 2+ households could have today's alert slot silently used up by whichever household got checked first.
- New `notifyNewExpenseToHousehold`: pushes every OTHER household member whenever ANY member adds a new expense (not just split ones), so nobody misses household activity. Split participants still get the more specific "split with you" push (`notifyNewSharedExpense`, unchanged) and are excluded from the general one to avoid a duplicate. Wired into `scan.tsx`'s save path only (new-expense creation) — editing an existing receipt doesn't re-fire it.

## Categories — two new ones added, one has special behavior

- **Electricity**: a normal new category — type, keywords (utility company names), icon (⚡), and every category-color map. Note several of those maps use `as Record<Category, string>` type ASSERTIONS (`constants/theme.ts`, and a plain-object map in `lib/pdfExport.ts`) that bypass TypeScript's completeness checking — `tsc` will NOT catch a missing category there. Grep for `Groceries:` across the repo to find every category-keyed map if you add another category.
- **Recurring**: selectable as a category too, per explicit request — picking it in the category chip row (`app/(tabs)/scan.tsx`, receipt-level picker only, not the per-line-item ones) auto-enables "Repeat this expense" so the user doesn't have to set both separately. This deliberately overlaps with the pre-existing Recurring pseudo-budget axis — both `app/(tabs)/index.tsx` and `lib/notifications.ts` have a guard (`r.category !== RECURRING_BUDGET_KEY`) to avoid double-counting a receipt that hits both paths.

## Responsive layout audit — fixed 6 real issues, rest of the app checked out clean

A full static-code audit (no simulator available) of every screen found and fixed:
1. Home tab had no `SafeAreaView` at all, using a fixed `paddingTop: 58` guess at the status bar/notch inset. Now `SafeAreaView edges={['top']}` + normal spacing.
2. `auth.tsx` explicitly excluded the top safe-area edge, compensating with a fixed `paddingTop: 46` — could render under the notch/Dynamic Island. Now `edges={['top', 'bottom']}`.
3. Household name chip's text had no `flexShrink`, so `numberOfLines={1}` couldn't actually truncate — a long name could push the swap icon off the chip. Added `flexShrink: 1`.
4. Onboarding's slide width came from `Dimensions.get('window')` read once at module load (stale after a runtime resize — split-screen, foldable, Stage Manager). Switched to `useWindowDimensions()`.
5. Reports' category label had no `numberOfLines` — a long custom tag could wrap and misalign the row.
6. `edit/[id].tsx` only claimed the top safe-area edge (`edges={['top']}`) unlike every other modal screen in the app — now `['top', 'bottom']`.

## Other fixes this session

- **Edit Profile not pre-filling** (`app/edit-profile.tsx`): fields used `useState(profile?.field ?? '')` for their initial value, which only applies on the very first render — if `profile` from `AuthContext` was still `null` at that exact mount moment, the fields locked in empty forever with no re-sync once it actually loaded (showed only placeholder text). Fixed with a one-time hydration `useEffect` keyed on `profile` becoming available, guarded by a ref so it never re-fires and clobbers later edits.
- Removed the "See who owes what — Balances" link from Settings' Household section per explicit request (Balances is still reachable elsewhere).
- `ITSAppUsesNonExemptEncryption: false` added to the local `ios/ReceiptScanner/Info.plist` (already correct in `app.config.js`, was missing locally — see the `ios/` tracking section above) — skips the manual "Provide Export Compliance Information" prompt in App Store Connect on future Xcode-built TestFlight uploads.

## Earlier sessions' real bugs/patterns (still relevant)

- **Dark-mode contrast**: `t.colors.primary` (dark navy) is invisible on dark backgrounds — use `t.colors.accent` for anything that needs to read against a dark-mode surface.
- **Currency**: everything numeric is USD-canonical; always render through `formatCurrency`.
- **Cloud sync 3-way chain**: `types/index.ts` → `serializeReceipt`/`CloudReceiptShape` → `upsertReceiptFromCloud`. Adding a new `Receipt` field to the type and local DB but forgetting one of these has happened repeatedly — double-check the pattern whenever adding a field.
- **New native dependencies** always need a fresh native build — OTA can't add native code, and this project has no `eas update` publish step wired into CI (an OTA `updates.url` IS configured in `app.config.js`, but nothing ever calls `eas update` to actually publish through it — every code change, JS or native, currently requires a full new native build to reach a device).
- **EAS build image**: iOS build profile needs `"image": "latest"` in `eas.json` (or a specific image with Xcode 26+) or Apple rejects the upload after the fact, not at build time.

## Suggested first steps in a new session

1. Confirm whether the user actually uploaded the delivered `.aab` (versionCode 6) to Play Console — if not, that's the immediate task.
2. Check `release-build.yml`'s most recent iOS job logs before assuming it works — last known state was failing, root cause not reconfirmed after the distribution-cert fix.
3. Check whether the EAS Free-plan Android quota has reset (Sept 1 2026) before relying on `release-build.yml`'s Android job again; use `android-build.yml`'s local-build path in the meantime.
4. `.gitignore`-untracked `firebase-hosting/privacy/` and `firebase-hosting/support/` directories have been sitting untracked since a much older session — not touched this session, unclear if intentional; worth asking rather than assuming.
