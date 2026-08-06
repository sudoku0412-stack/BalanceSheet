import {
  CorrectionExample,
  GeminiErrorKind,
  GeminiParseResult,
  parseGeminiPayload,
} from './geminiParseReceipt';

/**
 * App-side client for the NestExpenseTracker Cloudflare Worker that proxies
 * receipt parsing through Workers AI (Llama 3.3 70B by default). Used
 * as the FREE-FOR-ALL-USERS default when:
 *   - the user has NOT pasted their own Gemini key in Settings, AND
 *   - the bundled shared Gemini key is absent / quota-exhausted.
 *
 * Returns the SAME `GeminiParseResult` shape as parseReceiptWithGemini
 * so the calling code can pick whichever backend it likes without
 * special-casing the response. The worker's JSON output is fed
 * through parseGeminiPayload for validation + discount-merge.
 */
export async function parseReceiptWithCloudflare(args: {
  rawText: string;
  endpoint: string;
  appSecret?: string;
  signal?: AbortSignal;
  examples?: CorrectionExample[];
}): Promise<GeminiParseResult> {
  const { rawText, endpoint, appSecret, signal, examples = [] } = args;

  if (!endpoint) {
    return { ok: false, kind: 'no-key', error: 'no worker endpoint configured' };
  }
  if (!rawText.trim()) {
    return { ok: false, kind: 'no-key', error: 'empty OCR text' };
  }

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(appSecret ? { 'x-app-secret': appSecret } : {}),
      },
      body: JSON.stringify({ rawText, examples }),
      signal,
    });
  } catch (e) {
    return {
      ok: false,
      kind: 'network',
      error: `network: ${(e as Error)?.message ?? 'unknown'}`,
    };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const kind: GeminiErrorKind =
      resp.status === 429
        ? 'rate-limited'
        : resp.status === 401 || resp.status === 403
          ? 'auth'
          : resp.status >= 500
            ? 'server'
            : 'unknown';
    return {
      ok: false,
      kind,
      error: `http ${resp.status}: ${body.slice(0, 300)}`,
    };
  }

  const text = await resp.text();
  return parseGeminiPayload(text);
}
