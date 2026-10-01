# Phase 3 — Magic-link email invites

Two console-side setups are required before email invites work
end-to-end. App code is already shipped; the deeper-link config in
`app.config.js` will go live with the next APK build.

The flow you're enabling:

> Inviter taps "Send invite" → Firebase sends an email → invitee
> taps the link → app opens (or Play Store / App Store if not
> installed) → invitee signs in → existing pending-invite flow
> shows the Accept modal.

---

## 1. Firebase Auth — enable Email Link sign-in

This is the one-click Firebase prerequisite.

1. **Firebase Console → Build → Authentication → Sign-in method**
2. Find the **Email/Password** provider in the list (it's usually already
   there from Google Sign-In setup, but disabled or only the password
   half enabled).
3. Click the row → flip BOTH switches on:
   - **Email/Password** — `Enabled`
   - **Email link (passwordless sign-in)** — `Enabled`
4. Click **Save**.

If you don't see `Email link (passwordless sign-in)` as a separate row,
it's a sub-option under the Email/Password provider's settings — open
the provider, scroll, toggle it on.

---

## 2. Firebase Auth — authorized domains

The hosting domain you're about to set up has to be on the auth
allowlist; otherwise Firebase refuses to issue email links pointing at it.

1. **Authentication → Settings tab → Authorized domains**
2. Click **Add domain** → enter `balancesheet-android.web.app` (the
   default Hosting domain — see step 3 below).
3. `localhost` and `<project>.firebaseapp.com` are usually already
   there. Leave them.

---

## 3. Firebase Hosting — create the site

Firebase Hosting is free. The site only needs to host two static
files (universal-link / app-link verification). No backend code.

### Set up Hosting

Easiest path is the CLI. Run from anywhere on your Mac:

```bash
npm install -g firebase-tools     # if not already installed
firebase login                    # opens browser → use your Google account
cd ~/Claude/BalanceSheet          # or wherever
firebase init hosting
```

Wizard prompts:

- **Use an existing project** → pick `balancesheet-android`.
- **Public directory** → `firebase-hosting` (creates a new folder).
- **Single-page app** → `No`.
- **GitHub deploys** → `No`.
- **Overwrite index.html** → `No`.

That generates `firebase-hosting/` and a `firebase.json` in the repo.

### Add the verification files

Two files have to live at exact paths so iOS and Android can verify
the universal/app-link relationship between your domain and the app.

**`firebase-hosting/.well-known/apple-app-site-association`**

iOS reads this. It MUST be served as `application/json` AND have NO
file extension. Content:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "<TEAM_ID>.com.kaushikmajumder.receiptscanner",
        "paths": ["/invite", "/invite/*"]
      }
    ]
  }
}
```

Replace `<TEAM_ID>` with your Apple Developer team id (the 10-character
prefix from your Apple Developer account → Membership → Team ID). If
you haven't enrolled in Apple Developer Program yet, leave the iOS
half unconfigured and only Android invites will work.

**`firebase-hosting/.well-known/assetlinks.json`**

Android reads this. Content:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.kaushikmajumder.receiptscanner",
      "sha256_cert_fingerprints": [
        "<APP_SIGNING_CERT_SHA256>"
      ]
    }
  }
]
```

Get the SHA-256 of your app signing certificate:

```bash
# From the NestExpenseTracker repo:
npx eas-cli credentials --platform android
# Pick "BalanceSheet preview" credentials → it prints the SHA-256.
# Format it as colon-separated hex: AA:BB:CC:DD:...
```

Paste the colon-separated hex into the `sha256_cert_fingerprints` array.

**`firebase-hosting/firebase.json`** — make sure the apple file gets the
right MIME type (no extension trips up the default server):

```json
{
  "hosting": {
    "public": "firebase-hosting",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "headers": [
      {
        "source": "/.well-known/apple-app-site-association",
        "headers": [
          { "key": "Content-Type", "value": "application/json" }
        ]
      }
    ]
  }
}
```

### Optional: redirect page for tap-from-web

If someone taps the link from a desktop browser (no app to open),
Firebase shows a generic page. You can override it with a tiny
`firebase-hosting/index.html` that explains what NestExpenseTracker is +
links to the App / Play Store. Not required for the flow to work.

### Deploy

```bash
firebase deploy --only hosting
```

The output prints the live URL. It should be
`https://balancesheet-android.web.app`. If yours is different
(e.g. you previously claimed a custom hosting site name), update
`app.config.js` and `lib/inviteLink.ts` both — search-replace
`balancesheet-android.web.app` with whatever you got.

### Verify the files are reachable

```bash
curl -i https://balancesheet-android.web.app/.well-known/apple-app-site-association
curl -i https://balancesheet-android.web.app/.well-known/assetlinks.json
```

Both should return HTTP 200 with the JSON body. iOS's universal-link
verification runs on app install — Android's app-link verification
runs the same way (which is why we need a fresh APK build after
this change).

---

## 4. Build a new APK

The associated domains / intent filters in `app.config.js` are native
config — they only take effect after a fresh APK. The push to main
that ships Phase 3 also triggers the GitHub Actions Android build
automatically. Wait for it (~16 min from push), download from
**Artifacts**, install over the previous build.

---

## 5. Test the loop

1. App A (you, signed in as `kaushik@gmail.com`):
   - Settings → Family → "+ Invite family member"
   - Enter the OTHER email you'll use to sign in on App B
   - Tap "Send invite" → expect "Invite sent" toast
2. Check the other email's inbox — there should be a Firebase email
   with subject like "Sign in to NestExpenseTracker". Body has a button /
   link.
3. App B (other phone, OR a different Android emulator, OR same
   phone with NestExpenseTracker uninstalled):
   - If app installed: tap the link in the email → app opens to the
     "Confirm your email" screen → enter the email → tap Continue.
   - If app NOT installed: tap the link → Play Store / App Store
     opens with NestExpenseTracker → install → app launches via the link
     → "Confirm your email" screen.
4. After Continue, Firebase Auth signs them in. AuthContext spots
   the pending invite in `invites/{email}` and shows the existing
   "Accept invite" modal.
5. Tap Accept → invitee is now in your household. Scan a receipt on
   either device → both dashboards update within a few seconds.

---

## Cost

`auth().sendSignInLinkToEmail()` is FREE on the Spark plan — Firebase
uses their own SMTP infrastructure under the hood. There's a daily
quota (somewhere around 5–10 invites/day on the free tier, much higher
on paid) that the app won't realistically hit for personal use.

Hosting is free for the static-file traffic the verification files
generate (handfuls of requests per install). Firebase Hosting's free
tier is 10 GB / month which is multiple lifetimes' worth.
