# Cloudflare Worker — receipt parser fallback

This worker lets NestExpenseTracker keep working when the bundled Gemini free
tier hits its daily 1500-request limit. It proxies receipt OCR text
through Cloudflare Workers AI (Llama 3.3 70B by default), which has a
separate free tier (~10k neurons/day, enough for ~300 parses/day).

The app picks a backend in this order:

1. The user's own Gemini key from Settings (if they pasted one)
2. The shared Gemini key bundled in `app.config.js` (until daily quota)
3. **This Cloudflare Worker** (when both Gemini paths fail)
4. The local regex parser

You only need to deploy this worker once. After that, every user
benefits without configuring anything.

---

## One-time setup (15 minutes)

### 1. Cloudflare account

Sign up at <https://dash.cloudflare.com>. No card required for the free
tier.

### 2. Install Wrangler

```sh
npm install -g wrangler
wrangler login   # opens a browser to authorize
```

### 3. Create a new Worker project

In a directory **outside** this repo (so the worker has its own
package.json and git history):

```sh
wrangler init balancesheet-parser
# pick: Hello World Worker, TypeScript, Yes to git, No to deploy
cd balancesheet-parser
```

### 4. Drop in the worker code

Replace the generated `src/index.ts` with the contents of this repo's
[`scripts/parse-receipt-worker.ts`](./parse-receipt-worker.ts).

### 5. Bind Workers AI

Add this block to `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

### 6. Set the shared secret

Pick any 32+ character random string. This stops random people who
scrape your worker URL from burning your free quota.

```sh
wrangler secret put APP_SECRET
# paste the random string
```

Keep the same string handy — you'll add it to the NestExpenseTracker app
config in step 8.

### 7. Deploy

```sh
wrangler deploy
```

Note the URL Wrangler prints, e.g.
`https://balancesheet-parser.<your-subdomain>.workers.dev`.

### 8. Wire the worker into the app

Back in the NestExpenseTracker repo, add two EAS env vars on the `preview`
environment (and `production` if you publish to the Play Store):

```sh
eas env:create --environment preview --name PARSE_ENDPOINT \
    --value 'https://balancesheet-parser.<sub>.workers.dev/parse'

eas env:create --environment preview --name PARSE_ENDPOINT_SECRET \
    --value '<the same APP_SECRET from step 6>'
```

Then re-publish OTA so the app picks up the new config:

```sh
eas update --branch preview --environment preview \
    --message "wire cloudflare receipt parser worker"
```

---

## Cost & quota notes

Free-tier headroom on Cloudflare:

- **Workers:** 100,000 requests/day. Effectively unlimited for a hobby
  receipt-scanner app.
- **Workers AI:** 10,000 neurons/day. The worker defaults to
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast` which costs roughly
  30-40 neurons per typical receipt parse — about 300 parses/day.

If you need more headroom:

- Switch `MODEL` at the top of the worker to
  `@cf/meta/llama-3.1-8b-instruct` — ~5 neurons each, ~2000 parses/day
  on the free tier. Quality drops slightly but is still good for most
  receipts.
- Upgrade Workers AI to the paid plan ($5/month for 5M neurons,
  pay-as-you-go after).

The worker also includes a simple in-memory per-IP rate limit
(10 requests/minute per IP) so a single abuser can't drain your free
quota in seconds. For stricter limits, swap the `ipCounts` Map for a
Cloudflare KV namespace.

---

## Testing the worker

After deploy, you can hit it from your laptop with `curl`:

```sh
curl -X POST https://balancesheet-parser.<sub>.workers.dev/parse \
  -H 'Content-Type: application/json' \
  -H 'x-app-secret: <the same secret>' \
  -d '{"rawText": "TEST STORE\nMILK 3.99\nSUBTOTAL 3.99\nTAX 0.39\nTOTAL 4.38"}'
```

You should get JSON back with `store`, `total`, and an `items` array.

---

## Updating the worker

If you change the prompt or model in
`scripts/parse-receipt-worker.ts`, copy the new file to
`balancesheet-parser/src/index.ts` and re-run `wrangler deploy`. No app
rebuild needed — the URL is unchanged.
