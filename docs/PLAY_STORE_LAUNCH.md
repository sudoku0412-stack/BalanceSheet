# Play Store launch checklist — Receipt Scanner

Step-by-step from "code on main" to "live on the Play Store." Most of
this is one-time setup; once you've shipped v1.0.0 the recurring
release flow is tiny (see [Recurring releases](#recurring-releases)
at the bottom).

> **Status flags below**: ✅ done · ⚠️ partial / needs update · ❌ not started · 👤 only you can do this (account / dashboard work)

---

## 1. Pre-flight: things that must be true in the code

| Item | Status | Notes |
|---|---|---|
| `eas.json` production profile builds `.aab` | ✅ | `buildType: "app-bundle"` set |
| `versionCode` auto-increments | ✅ | `autoIncrement: true` in eas.json |
| `versionCode` starts at a fresh value | ✅ | Currently `1` in app.config.js; ok for first upload |
| `version` (user-visible) | ✅ | `1.0.0` in app.config.js |
| Target Android API 34+ | ✅ | Expo SDK 51 default |
| Production EmailJS env vars set | ✅ | `eas env:create ... --environment production` already run for the three EMAILJS_* vars |
| Production Gemini key set | ⚠️ | `GEMINI_API_KEY` set on preview — check it's also on production: `eas env:list --environment production` |
| Production Firestore rules deployed | ✅ | Rules in Firebase console support members + invitees |
| App icon at 512×512 PNG | ⚠️ | Currently `./assets/icon.png` — Play needs a 512×512 PNG without transparency for the store listing |

---

## 2. Google Play Developer account 👤

1. Go to **<https://play.google.com/console/signup>**
2. Pay the **one-time $25 fee**
3. Verify identity (Google may ask for a government ID — takes 1–2 business days)
4. Set up your **developer profile**: name, email, website (use `https://github.com/sudoku0412-stack/NestExpenseTracker` if you don't have one)

Start this in parallel with the rest — the verification wait blocks everything else.

---

## 3. App signing — Play App Signing (recommended)

EAS Build currently uses its own keystore to sign your APKs. For Play Store, the recommended approach is **Play App Signing**: Google holds the production signing key, you hold an "upload key" used to sign each .aab you upload. If your upload key ever gets compromised you can reset it via Play Console — without this, a lost key would mean you can never update the app again.

### How to set it up

When you create the app in Play Console (step 4), Play will offer Play App Signing as the default. Accept it. Then:

**Option A — let Google generate both keys** (easiest):
- During app creation, choose "**Use Google-generated key**"
- EAS will sign uploads with its own keystore (which becomes your "upload key" in Play terminology)
- Run `eas credentials --platform android` interactively at least once to inspect the cert fingerprint EAS uses; this is the fingerprint Play needs to match against incoming uploads

**Option B — supply your own existing keystore**:
- Only relevant if you already have a release keystore from a previous Android project. You don't, so skip this.

After setup, your `.aab` uploads must always be signed with the EAS keystore. If EAS rotates your keystore (rare, but possible), you'd need to update Play Console with the new upload cert.

---

## 4. Create the app in Play Console 👤

1. Play Console → **All apps** → **Create app**
2. **App name**: `Receipt Scanner`
3. **Default language**: English (United States)
4. **App or game**: App
5. **Free or paid**: Free
6. Confirm guidelines acknowledgement
7. Click **Create app**

Once created, you land on the **Dashboard** with a long left-rail of sections to fill out before you can submit. The ones that matter for v1:

- App content → **Privacy policy** (URL)
- App content → **App access** (any login required?)
- App content → **Ads** (no)
- App content → **Content rating** (questionnaire)
- App content → **Target audience and content**
- App content → **News app** (no)
- App content → **Data safety** ⚠️ **needs careful answers** — see below
- App content → **Government apps** (no)
- App content → **Financial features** (no, the app tracks expenses but isn't a financial service)
- Store presence → **Main store listing**
- Production → **Create new release**

---

## 5. ⚠️ Critical: rewrite `docs/STORE_LISTING.md` before pasting into the listing

The existing `docs/STORE_LISTING.md` was written when the app was fully offline. It now has **factually wrong** claims that would cause Play to reject the Data Safety form mismatch:

| Stale claim in current STORE_LISTING.md | What's actually true now |
|---|---|
| "100% private, 100% offline" | App syncs receipts to Firestore, uploads photos to Firebase Storage |
| "No accounts" | Email/password, Google sign-in, and phone auth are all live |
| "No cloud sync" | Firestore shadow-write on every receipt save |
| "The app never makes a network request" | Calls Firebase Auth, Firestore, Storage, Gemini API, Cloudflare Worker, EmailJS |
| Data Safety "Does your app collect... data? No" | Collects email, name, receipt photos, receipt content, household membership |
| "Uninstall removes all data" | Local data yes; cloud data persists in Firestore until the user runs Settings → Delete Account |

### Updated copy to paste (draft)

```
Receipt Scanner is a fast expense tracker that turns paper receipts into structured spending data — scanned locally with on-device OCR, then synced to your family's shared view.

KEY FEATURES

• Smart receipt scanning
Snap a photo or import from your gallery. On-device OCR extracts store, total, date, and line items.

• AI-powered categorization
Each line item is auto-classified across 10 categories (Groceries, Electronics, Dining, Pharmacy, Gas, Clothing, Entertainment, Travel, Healthcare, Other). Powered by Gemini 2.5 Flash with a privacy-respecting Cloudflare Workers AI fallback.

• Family sharing
Invite a partner or family member by email — they tap one link, set a password, and immediately see every receipt you've scanned. New scans sync to all household members in real time.

• Monthly dashboard & reports
Total spending, top category, per-category breakdown, top stores, recurring purchases. Export any month as a branded PDF.

• Offline-first
Receipts live in a local SQLite database on your device; cloud sync is a shadow-write on top, so the app stays instant and works without a network.

• Search & edit
Full-text search across stores, categories, and notes. Edit any field after saving.

• Biometric lock
Optional Face ID / fingerprint lock on app launch.

PERMISSIONS

• Camera — only when you tap "Camera" to photograph a receipt
• Photos — only when you tap "Gallery" to import an image
• Internet — required for sign-in, family sharing, AI categorization, and OTA updates
• Biometric — only used if you enable the app lock in Settings

PRIVACY

• Your receipts are stored on your device first, then mirrored to a private Firestore database accessible only to your household members.
• AI categorization sends the OCR text (not the photo) to Google Gemini or a Cloudflare Worker for parsing.
• Photos are stored in Firebase Storage under your household's namespace; only members of your household can read them.
• Full privacy policy: https://sudoku0412-stack.github.io/NestExpenseTracker/privacy-policy.html
• Delete your account from Settings → Account → Delete account; this wipes all your cloud data.

Built with React Native + Expo + Firebase + Gemini. Open source on GitHub.
```

### Updated Data Safety answers

| Question | Answer |
|---|---|
| Does your app collect or share any required user data? | **Yes** |
| Personal info collected | Email address (account), Name (display name), User IDs (Firebase Auth UID) |
| Financial info collected | Other financial info (receipt amounts, line items) |
| Photos and videos collected | Photos (receipt images) |
| App activity collected | None |
| App info and performance collected | Crash logs (if you enable Firebase Crashlytics later) |
| Device or other IDs | No |
| Data is shared with third parties? | **Yes** — Gemini AI (OCR text only), Cloudflare Workers AI (fallback OCR text), EmailJS (invite emails) |
| All data encrypted in transit? | **Yes** (HTTPS to Firebase, Gemini, EmailJS) |
| User can request data deletion? | **Yes** — Settings → Delete Account |
| Is your data collection optional or required? | **Required** to use the app |

### Updated content rating

Still **Everyone**. Receipt-tracking has no objectionable content.

### Permissions justification (Play asks for short strings)

- **Camera**: "Used only when the user taps Camera to photograph a receipt."
- **Photos / Media**: "Used only when the user taps Gallery to import a receipt image."
- **Biometric**: "Optional app-lock unlock, controlled by the user in Settings."

---

## 6. Privacy policy hosting 👤

The privacy policy HTML is ready at `docs/privacy-policy.html`. Host it for free on GitHub Pages:

1. Go to **<https://github.com/sudoku0412-stack/NestExpenseTracker/settings/pages>**
2. Source: **Deploy from a branch** → Branch `main`, folder `/docs`
3. Save → wait ~30 seconds
4. Verify it loads at `https://sudoku0412-stack.github.io/NestExpenseTracker/privacy-policy.html`
5. ⚠️ **Update the privacy policy text first** — the current HTML may have stale "no data leaves device" claims (mirror the corrections from the Data Safety table above)

Paste this URL into Play Console → App content → Privacy policy.

---

## 7. Store assets you still need to make 👤

| Asset | Spec | How |
|---|---|---|
| App icon (Play listing) | 512×512 PNG, no transparency | Re-export from `assets/icon.png` at 512px — or use the existing 1024×1024 and resize |
| Feature graphic | 1024×500 PNG, no transparency | Canva or Figma — show app name + tagline on the emerald background |
| Phone screenshots | 2–8 PNGs, min 1080×1920 | Install the latest preview APK, screenshot: dashboard with 3+ receipts, scan screen, edit form, history, settings/family panel |
| Tablet screenshots | Optional but recommended | Skip if you don't have a tablet; not required |

---

## 8. First production build

After everything above is in place, run:

```bash
cd /Users/kaushiksudesna/Claude/BalanceSheet
eas build --profile production --platform android
```

This will:
- Prompt for credentials on first run (let EAS generate a keystore — note the fingerprint, you'll need it for Play Console)
- Build an **`.aab`** in EAS's cloud (~12–16 min)
- Return a download URL when done

Download the `.aab` to your machine.

---

## 9. Upload to Play Console 👤

1. Play Console → **Production** → **Create new release**
2. **Upload** the `.aab` file
3. **Release name**: `1.0.0` (matches app.config.js)
4. **Release notes**:
   ```
   Initial release.
   ```
5. Click **Next** → **Save** (don't roll out yet — review the rest first)

Then complete the remaining App content sections:
- App access (no login wall before features? Yes/No depending on your view)
- Content rating questionnaire (answer No to everything → Everyone rating)
- Target audience: 18+ (financial data is the safer choice)
- Data safety (use the answers from §5 above)
- News app: No
- Government apps: No

When everything has a green checkmark, **Production → Review release → Start rollout to production**.

---

## 10. Internal testing first (strongly recommended) 👤

Before going to Production, push the same `.aab` to **Internal testing**:

1. Play Console → **Testing → Internal testing** → Create release
2. Upload the same `.aab`
3. Add yourself + 2-3 trusted testers as **Tester emails**
4. Roll out — appears within minutes (no Play review)
5. Testers install via the **opt-in link** Play gives you, run through the full flow (sign-up, scan receipt, invite a family member, accept invite on a second device)
6. Only when this works end-to-end, **promote** the same release to Production

Skipping internal testing means your first production users hit any bugs Play didn't catch. Don't skip.

---

## 11. Play review

After you click "Start rollout to production":
- Review takes **2–7 days** for first-time apps from new developers (Google's new-developer review window). Subsequent updates are usually approved in 4–24 hours.
- Reviewers run the app on a real device. They check Data Safety claims against actual network calls. If your declared data doesn't match what they observe, you get a rejection email with details — fix and re-submit.

---

## Recurring releases

After v1 is live, each subsequent release is:

```bash
# 1. Make code changes, commit, push
git push origin main

# 2. Bump version in app.config.js if you changed native code
#    (skip for JS-only updates — those go via `eas update` instead)

# 3. Build
eas build --profile production --platform android

# 4. Submit (one command instead of manual upload)
eas submit --profile production --platform android --latest
```

`eas submit` automates the Play Console upload. You still need to manually click "Roll out to production" in the console unless you set up automated rollout (advanced).

For JS-only changes (no new native modules, no native config), use **`eas update --branch production`** instead of a rebuild — pushes to installed devices in minutes via OTA. The Play Store version stays the same.

---

## Common pitfalls

- **"Your app contains files that aren't optimized" warning** — Play tells you to enable R8/ProGuard. Expo SDK 51 already does this; the warning sometimes shows on the first upload regardless. Ignore unless rejection.
- **Data Safety mismatch rejection** — most common reason for first rejection. The wording in your Data Safety form must match what Play's automated scanner sees the app actually doing. Be honest about Firestore, EmailJS, and Gemini calls.
- **"App is using a deprecated API"** — usually targetSdk. Expo 51 already targets 34, which is current.
- **Long descriptions get flagged for "engagement claims"** — avoid superlatives ("the best", "fastest"). The draft copy in §5 is safe.
- **Forgetting to update versionCode** — EAS handles this with `autoIncrement: true`. If you ever turn that off, you'll get "Version code XX has already been used" on upload.
