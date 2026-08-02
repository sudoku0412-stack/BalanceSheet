# BalanceSheet — Handover Notes (superseding the previous version of this file)

Repo root: `/Users/kaushiksudesna/Claude/BalanceSheet`. React Native / Expo, expo-router, Firebase (auth/firestore/storage), SQLite local store, EAS build/update.

**User preferences — apply from message one:**
- Terse, resolution-only responses. No "here's what I'm about to do" narration, no process play-by-play, no in-progress status updates. State results, not steps.
- Standing blanket permission to run anything (builds, pushes, installs, package adds). Don't ask for routine dev actions. Still stop for genuinely destructive/irreversible things or anything needing credentials only the user has.
- Both preferences are also saved in this Claude Code install's cross-session memory (`~/.claude/projects/-Users-kaushiksudesna-Claude/memory/`), so a fresh session here should pick them up automatically.

## Current state (confirmed working on-device, both platforms, end of last session)

- **Phone number verification** (Settings → "Phone number"): add/verify via OTP, remove. `lib/phoneVerification.ts`, `lib/phone.ts`.
- **Splitwise-style balances**: Balances screen (Settings → Household → "See who owes what") shows net owed/owing per household member. Tapping a person (from Balances, or from the member list itself) opens `app/shared-expenses/[uid].tsx` — a filtered list of just the receipts shared with that one person, each row showing that receipt's own owed/owing share (not its full total), with a header total matching the Balances screen. `lib/balances.ts`.
- **Add household member by phone**: Settings → "Add by phone contact" → native contact picker → matches an existing verified user (self-joins silently on their next sign-in, no accept prompt) or, if unmatched, opens the OS share sheet with an invite message pre-filled so you send it yourself (Messages/WhatsApp/etc — no Twilio, no cost). Confirmed working end-to-end: both accounts now see each other in Settings → Household, and shared-expense balances reconcile correctly on both phones after all the fixes below.
- All 311 tests + `tsc --noEmit` pass. Everything is committed to git (`03a1871`) — **not yet pushed to the `origin` remote.**

## Real bugs found and fixed this session (read before touching split/sync code again)

This session had an unusually long chain of real, confirmed-on-device bugs in the cloud-sync path. In order of discovery:

1. **Recurring-expense duplicate** — `recurring.nextDueDate` was seeded at the receipt's own date instead of one period later, so the next sign-in treated it as already-due. Fixed in `lib/recurring.ts`'s `advance()`, used in `scan.tsx`/`edit/[id].tsx`.
2. **Expenses tab showed raw USD** — `history.tsx` bypassed `formatCurrency`. Fixed.
3. **Reports header total vs. category breakdown never matched** — header summed post-tax `totalAmount`, category breakdown summed pre-tax line items. Fixed in `lib/reports.ts` by prorating tax across categories.
4. **`users/{uid}` Firestore rule was self-read-only** — broke `getHouseholdMembers` (member names) for any REAL multi-member household; nobody had one until this session's phone-invite testing. Fixed: any member of the same household can read another member's `users/{uid}` doc.
5. **App failed to open at all** after several rapid OTA pushes — `app/_layout.tsx` called `initDatabase()` fire-and-forget, so the rest of the app could query DB columns before ALTER TABLE migrations finished. Fixed by gating render on a `dbReady` state (same pattern as the existing `fontsLoaded` gate). Not reproduced locally — diagnosed from symptoms + code review, flagged as "likely, not certain" at the time; no recurrence since.
6. **Balances page bounced straight back to Home** — a route guard (`STICKY_VOLUNTARY` in `_layout.tsx`) whitelists which screens it won't force-redirect away from; `balances`/`shared-expenses` weren't on it. Fixed.
7. **Split data used the literal string `'self'`** for whichever device last saved it, instead of a real uid — so on any OTHER household member's device, `'self'` resolved to THEM instead of the true creator, silently dropping the real creator out of the participant set (showed as "All settled up" even with a real split). Fixed at the source: `edit/[id].tsx` and `scan.tsx` now substitute the signed-in user's real uid before persisting (`split.participantIds`, `split.values` keys, `LineItem.splitWith`), mirroring how `paidBy` already worked. **Old data saved before this fix still only resolves correctly on the device that created it** — re-toggling split (off/on, save) on an old receipt fixes it going forward.
8. **A re-saved split still didn't propagate cross-device** even after #7 — `updateReceipt` stamped a fresh timestamp for the LOCAL row but shipped the caller's STALE `receipt.updatedAt` to the Firestore shadow-write. Combined with a "skip if local already at least as fresh" guard (added to fix #9 below), the two fixes fought each other and silently blocked real edits from syncing. Fixed by stamping one `now` and using it for both local and cloud.
9. **Split settings appeared to reset after a native rebuild** — `syncReceiptToCloud` is fire-and-forget; killing the app (for a rebuild) right after a save but before that write reached Firestore left a stale cloud doc, which the next launch's full resync then used to silently overwrite the correct local edit. Fixed by comparing `updated_at` before overwriting in `upsertReceiptFromCloud` — skip if local is already at least as fresh. (This is the guard #8 above had to work around.)
10. **The actual root cause of the cross-device balance gap, found via a temporary debug panel**: Firestore rejects an ENTIRE document write if any field — including nested ones — is `undefined`. `Receipt.split.values` is `undefined` for the default `'equal'` split method, so every equal-split receipt's cloud write was failing completely and silently (the receipt itself still synced fine on creation, before `split` existed, which is why it showed up in the Expenses tab but never carried its split data anywhere). Fixed with a recursive `stripUndefinedDeep()` in `lib/cloudSync.ts`'s `serializeReceipt` — general fix, not specific to this one field.
11. Settings profile showed literal "Signed in" instead of a name when the local `profile` row had no first/last name set (e.g. a fresh account). Now falls back to the Firebase Auth `displayName`.

**A temporary "Sync status (debug)" section is still in Settings** (`app/settings.tsx`, top of screen) — shows `getCloudSyncDiagnostics()`'s last receipt-sync result (OK/FAILED + message). This is how bug #10 was actually found; cloud sync has no other user-facing error surface. Safe to leave, or remove now that things are confirmed stable — the user's call, wasn't asked to remove it yet.

## Manual infra, current status

- **Firestore rules**: now version-controlled (`firestore.rules` in the repo, wired via `firebase.json`, deployed with `firebase deploy --only firestore:rules`) — this used to be 100% console-managed with nothing checked in. Covers `phoneIndex/{phone}`, `phoneInvites/{phone}`, and the `users/{uid}` cross-member read fix above.
- **Twilio SMS — abandoned.** A Cloudflare Worker (`scripts/sms-invite-worker.ts`) was built and deployed live for this (`https://balancesheet-sms-invite.kmaz285.workers.dev/send`), and its auth/plumbing was verified working against the real Twilio API — but Twilio TRIAL accounts can only send from a small fixed set of Twilio's own canned demo messages, not real custom text, and the user doesn't want to pay for a full account. The app no longer calls this Worker at all; it uses the native share sheet instead (free, immediate). The Worker stays deployed and functional if the user ever revisits this.
- **Cloudflare + Twilio credentials were pasted directly into chat this session.** Not committed to the repo anywhere. Worth rotating the Cloudflare API token in particular, since it's not needed for anything active right now.
- **Native rebuild for `expo-contacts`**: done on iOS (confirmed — user hit a later, post-rebuild-only error). **Not confirmed on Android** — worth checking whether the Android build the user's testing on actually has `expo-contacts` linked, or whether it's still gracefully no-op'ing via the lazy-load fallback (`lib/contactPicker.ts`'s `isContactPickerAvailable()`).
- **Git**: everything committed locally (`03a1871`), NOT pushed to `origin` (`kaushik-majumder/BalanceSheet.git`, resolves to `sudoku0412-stack/BalanceSheet`). Push needs the token noted in prior handovers — still sitting exposed in an old chat transcript, still not rotated.

## Real bugs/patterns from EARLIER sessions (still relevant)

- **Dark-mode contrast**: `t.colors.primary` (dark navy) is invisible on dark backgrounds. Check any new button/chip/badge in dark mode.
- **Currency**: everything numeric is USD-canonical; always render through `formatCurrency`, never a bare `$` + raw number. This exact mistake has recurred multiple times (Add Expense, Expense Detail, PDF/CSV export, Expenses tab).
- **Cloud sync 3-way chain**: `types/index.ts` → `serializeReceipt`/`CloudReceiptShape` → `upsertReceiptFromCloud`. Adding a new `Receipt` field to the type and local DB but forgetting one of these has happened repeatedly (`originalCurrency`, `paidBy` both needed a follow-up fix).
- **Safe-area**: any `headerShown: false` custom-header screen needs `<SafeAreaView edges={['top', 'bottom']}>` — forgetting `'top'` puts the header under the notch.
- **expo-router tab-param stickiness**: a query param set once on a tab route persists across refocuses unless explicitly cleared.
- **New native dependencies** (`expo-camera`, `expo-notifications`, `expo-contacts`) always need `pod install` + a fresh Xcode rebuild — OTA can't add native code. Lazy-`require()` any such module instead of a top-level `import` if it's used from a screen that loads before the rebuild might have happened (see `lib/contactPicker.ts` for the pattern) — a top-level import crashed the whole Settings screen once already this session.

## Build / deploy state

- **iOS**: local Xcode build (Release config), no Apple Developer account → no EAS cloud iOS builds, no TestFlight. Free personal-team signing expires every 7 days, forcing a weekly reinstall regardless of code changes. An Apple Developer account ($99/yr) would fix that plus unlock EAS cloud builds and TestFlight — flagged to the user, no decision made.
- **Android**: EAS cloud builds work (`eas build --platform android`).
- **OTA**: `eas update --branch preview` after every JS-only-safe change — this is now the default working rhythm and was used constantly this session. Skip OTA for any commit that adds a new native dependency; rebuild first.

## Suggested first steps in a new session

1. Ask what, if anything, is still broken — this session ended with everything confirmed working, but don't assume that holds without asking, especially the Android side of the phone-invite feature (rebuild status unconfirmed there).
2. If the user wants to keep iterating on the household/split features, re-read the "real bugs" list above before touching `lib/cloudSync.ts`, `lib/balances.ts`, or the split-save paths in `edit/[id].tsx`/`scan.tsx` — several of these bugs interacted with each other in non-obvious ways.
3. Consider asking whether to remove the "Sync status (debug)" section from Settings now that things are stable, or push the local git commit to `origin`.
