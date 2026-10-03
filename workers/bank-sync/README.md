# Bank-sync Worker

Connects bank accounts through [Plaid](https://plaid.com) and hands new transactions to the app, which
puts them in the Review inbox. The Plaid secret and every bank token live **only here**, never in the app
or the repo.

```
App ──(Firebase ID token)──▶ Worker ──▶ Plaid
                               │
                               └─ Cloudflare KV: bank tokens (AES-GCM encrypted) + sync cursors
```

Routes (all need `Authorization: Bearer <Firebase ID token>`):

| Route | Purpose |
|---|---|
| `POST /v1/link` | Start Plaid Hosted Link; returns the URL the app opens in the browser |
| `POST /v1/complete` | After the user finishes, exchange the public token and store the connection |
| `GET /v1/items` | List connected banks (never returns tokens) |
| `POST /v1/sync` | Fetch new/changed/removed transactions (does not advance the cursor) |
| `POST /v1/ack` | App confirms it saved them; the cursor advances |
| `POST /v1/remove` | Disconnect a bank |

## Set up (sandbox first)

Run these in **your own terminal** from `workers/bank-sync/`. Secrets are typed at a prompt and never
written to a file in this repo.

```bash
npx wrangler login
npx wrangler kv namespace create BANK_KV        # paste the printed id into wrangler.toml
npx wrangler secret put PLAID_CLIENT_ID
npx wrangler secret put PLAID_SECRET             # use the SANDBOX secret first
openssl rand -base64 32 | npx wrangler secret put TOKEN_ENC_KEY
npx wrangler deploy                               # prints https://nestexpensetracker-bank-sync.<you>.workers.dev
```

Point the app at it (EAS env var, then rebuild or publish an update):

```bash
eas env:create --environment production --name BANK_SYNC_ENDPOINT \
    --value 'https://nestexpensetracker-bank-sync.<you>.workers.dev'
```

Test with Plaid's sandbox bank: pick any institution, username `user_good`, password `pass_good`.

## Going to production

1. Get Plaid **Production** access (Plaid dashboard → apply; enable Canada if you need RBC/TD/etc.).
2. Set `PLAID_ENV = "production"` in `wrangler.toml` and run `npx wrangler secret put PLAID_SECRET` with the
   **production** secret, then `npx wrangler deploy`.
3. Rotate any secret that was ever pasted into chat, email, or a ticket.

## Notes

- The Worker does not check Premium status; the app hides the feature from free users. Add a server-side
  entitlement check (RevenueCat REST API) before launching broadly, otherwise anyone with an account could
  use your Plaid quota.
- Firebase project id is set in `wrangler.toml` (`FIREBASE_PROJECT_ID`).
