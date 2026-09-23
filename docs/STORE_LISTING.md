# Google Play Store Listing — NestExpenseTracker

Copy/paste these fields into the Play Console when creating the store listing.

> **Note for next time you edit this file**: every claim about data
> handling needs to match what `docs/privacy-policy.html` says and what
> the Data Safety form below declares. Play's reviewers cross-check
> these three sources, and a mismatch is the most common reason for
> first-submission rejection. If you change one, change all three.

---

## App name (max 30 chars)

```
Receipt Scanner
```
*(15 chars)*

## Short description (max 80 chars)

```
Scan receipts, auto-categorize spending, and share with your household.
```
*(70 chars)*

## Full description (max 4000 chars)

```
Receipt Scanner turns paper receipts into structured spending data — scanned on-device, then synced across your family's phones.

KEY FEATURES

• Smart receipt scanning
Snap a photo or import from your gallery. On-device OCR (Google ML Kit on Android, Apple Vision on iOS) extracts the store name, total, date, and individual line items — the photo itself never leaves your phone for OCR.

• AI-powered categorization
Each line item is auto-classified across 10 categories: Groceries, Electronics, Dining, Pharmacy, Gas, Clothing, Entertainment, Travel, Healthcare, and Other. Powered by Google Gemini 2.5 Flash, with a Cloudflare Workers AI fallback so parsing keeps working even when the primary AI provider is rate-limited.

• Family sharing
Invite a partner or family member by email — they tap one link, set a password, and immediately see every receipt you've scanned. New scans sync to all household members within seconds via Firebase. Each household is fully private; only your invited members can see your receipts.

• Monthly dashboard & reports
See total spending, top category, and per-category breakdown for any month at a glance. Top stores, recurring purchases, and a clean PDF export with a branded layout.

• Offline-first
Receipts live in a local SQLite database on your device first; cloud sync is a shadow-write on top, so the app stays instant and works without a network. Photos are queued for upload when you regain connectivity.

• Search & edit
Full-text search across stores, categories, and notes. Edit any field after saving — store name, amount, date, or category.

• Biometric app lock
Optional Face ID / fingerprint lock on app launch.

PERMISSIONS

• Camera — only when you tap "Camera" to photograph a receipt
• Photos — only when you tap "Gallery" to import an image
• Internet — required for sign-in, family sharing, AI categorization, and over-the-air updates
• Biometric — only used if you enable the app lock in Settings

PRIVACY

• Receipts are stored on your device first, then mirrored to a private Firestore database where only members of your household can access them.
• OCR runs on-device — your receipt photo never leaves your phone for text extraction. Only the extracted text is sent to Google Gemini (or Cloudflare Workers AI as a fallback) for categorization.
• Photos are stored in Firebase Storage under your household's namespace; only household members can read them.
• No third-party analytics, no advertising SDKs, no behavioral tracking.
• Delete your account from Settings → Account → Delete account; this wipes all your cloud data.
• Full privacy policy: https://kaushik-majumder.github.io/BalanceSheet/privacy-policy.html

Built with React Native + Expo + Firebase + Google Gemini. Open source on GitHub.
```

## Category

`Finance`

## Tags

`expense tracker`, `receipts`, `budget`, `OCR`, `personal finance`, `family budget`

## Contact email

*(use any email you want public — required by Play Store)*

## Website

```
https://github.com/kaushik-majumder/BalanceSheet
```

## Privacy policy URL

```
https://kaushik-majumder.github.io/BalanceSheet/privacy-policy.html
```
*(active once GitHub Pages is enabled on the repo — see HOSTING_PRIVACY_POLICY.md)*

---

## Data Safety form answers

Play Console → App content → Data safety. These answers reflect the
current implementation (Firebase Auth + Firestore + Storage + Gemini +
EmailJS) and match `docs/privacy-policy.html`.

### Section 1 — Data collection and sharing

| Question | Answer |
|---|---|
| Does your app collect or share any required user data? | **Yes** |

### Section 2 — Data types collected

For each row, mark **Collected** and **Shared** as indicated.

| Data type | Collected | Shared | Reason |
|---|---|---|---|
| Personal info → Name | ✅ Yes | ❌ No | Account function, personalization (shown in family panel) |
| Personal info → Email address | ✅ Yes | ❌ No (only with you, the developer) | Account function, communications (invite emails) |
| Personal info → User IDs (Firebase UID) | ✅ Yes | ❌ No | Account function |
| Photos and videos → Photos | ✅ Yes | ❌ No | App functionality (receipt photos stored in your private household) |
| Financial info → Other financial info (receipt amounts, line items) | ✅ Yes | ❌ No | App functionality |
| App activity → App interactions | ❌ No | ❌ No | — |
| App info and performance → Crash logs | ❌ No | ❌ No | (Enable later if you add Firebase Crashlytics) |
| Device or other IDs | ❌ No | ❌ No | — |
| Location | ❌ No | ❌ No | — |
| Contacts | ❌ No | ❌ No | — |

> Note on "Shared": Play distinguishes between **storing data via a
> service provider** (Firebase, EmailJS, Gemini — these are processors
> working on your behalf) and **sharing data with third parties** (data
> brokers, analytics, ads — none of these). Answer "No" to sharing
> because we don't use any of the latter category.

### Section 3 — Security practices

| Question | Answer |
|---|---|
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS to Firebase, Gemini, EmailJS, Cloudflare) |
| Do you provide a way for users to request that their data be deleted? | **Yes** — Settings → Account → Delete account inside the app |

### Section 4 — Data usage and handling

For each data type marked Collected above, specify:

| Data type | Optional or required? | Purpose |
|---|---|---|
| Name | Required | Account management, personalization |
| Email | Required | Account management, communications |
| Firebase UID | Required | Account management |
| Photos (receipt images) | Optional (only if you scan a receipt) | App functionality |
| Receipt amounts / line items | Optional (only if you save a receipt) | App functionality |

---

## Content rating questionnaire

Answer "No" to all questions. The app contains:
- No violence
- No sexual content
- No profanity
- No drug references
- No gambling
- No user-generated content visible to other users outside the household
- No location sharing

Expected rating: **Everyone**.

---

## Target audience

Age groups: **18+** is the safer choice given the app handles personal financial data and account creation. If you're comfortable certifying you don't direct the app to children, 13+ is also acceptable per Play policy.

---

## Required screenshots

You need **2-8 phone screenshots**.

1. Install the latest preview APK on your Android device
2. Open the app and capture:
   - Dashboard with at least 3-4 receipts saved (shows the value)
   - Scan screen (Camera / Gallery / Manual entry buttons)
   - Receipt review form after scan (line items, category)
   - History / list view
   - Settings → Family panel (shows shared household members)
   - PDF export preview (optional, but visually distinctive)
3. Transfer the PNGs to your computer and upload to Play Console.

Recommended size: **1080×2340** (or whatever resolution your phone produces). Play accepts any 16:9 or 9:16 phone aspect.

---

## Feature graphic

Required: **1024 × 500 PNG**, no transparency, no alpha channel.

Design hints:
- Show the app name "Receipt Scanner" prominently
- Tagline option: "Scan. Categorize. Share."
- Visual hint of the app: a receipt icon plus the app's emerald-and-slate palette
- Background: `#0F172A` (slate-900) with `#10B981` (emerald-500) accents to match the app's actual theme
- Tools: Canva has a free "Google Play feature graphic" template. Figma works too if you prefer that.

---

## App icon (Play listing)

Required: **512 × 512 PNG**, no transparency.

The existing `assets/icon.png` is 1024×1024 — just resize to 512×512 for the listing. Confirm the result has no alpha channel (Play rejects RGBA).

---

## Release notes template

For the very first production release:

```
Initial release.
```

For subsequent releases, follow a "what's new for users" tone (not changelog):

```
• Bug fixes and performance improvements
• <one user-visible feature line if applicable>
```
