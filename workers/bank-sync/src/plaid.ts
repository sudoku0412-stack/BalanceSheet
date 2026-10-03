export type PlaidEnv = 'sandbox' | 'production';

export interface PlaidConfig {
  clientId: string;
  secret: string;
  env: PlaidEnv;
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id?: string;
  amount: number;
  iso_currency_code?: string | null;
  date: string;
  name: string;
  merchant_name?: string | null;
  pending?: boolean;
  personal_finance_category?: { primary?: string; detailed?: string } | null;
}

export interface SyncPage {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
}

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class PlaidError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Thin Plaid REST client. Credentials are passed in by the caller (the
 *  Worker reads them from its secrets) — nothing is hardcoded here. */
export class PlaidClient {
  constructor(
    private cfg: PlaidConfig,
    private fetchFn: FetchFn = (u, i) => fetch(u, i),
  ) {}

  private base(): string {
    return `https://${this.cfg.env}.plaid.com`;
  }

  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const resp = await this.fetchFn(`${this.base()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.cfg.clientId, secret: this.cfg.secret, ...body }),
    });
    const json = (await resp.json()) as Record<string, unknown>;
    if (!resp.ok) {
      throw new PlaidError(
        String(json.error_code ?? 'PLAID_ERROR'),
        String(json.error_message ?? 'Plaid request failed'),
        resp.status,
      );
    }
    return json as T;
  }

  /** Hosted Link: the app opens `hosted_link_url` in the system browser. */
  createLinkToken(args: { uid: string; language: 'en' | 'fr'; redirectUri?: string }) {
    return this.call<{ link_token: string; hosted_link_url?: string; expiration: string }>(
      '/link/token/create',
      {
        client_name: 'NestExpenseTracker',
        language: args.language,
        country_codes: ['CA', 'US'],
        user: { client_user_id: args.uid },
        products: ['transactions'],
        transactions: { days_requested: 90 },
        hosted_link: {
          is_mobile_app: true,
          ...(args.redirectUri ? { completion_redirect_uri: args.redirectUri } : {}),
        },
      },
    );
  }

  /** Public tokens (and institution names) from finished Link sessions. */
  async getLinkResult(linkToken: string): Promise<{ publicToken: string; institution: string }[]> {
    const res = await this.call<{
      link_sessions?: {
        results?: {
          item_add_results?: { public_token: string; institution?: { name?: string } }[];
        };
      }[];
    }>('/link/token/get', { link_token: linkToken });
    const out: { publicToken: string; institution: string }[] = [];
    for (const session of res.link_sessions ?? []) {
      for (const r of session.results?.item_add_results ?? []) {
        out.push({ publicToken: r.public_token, institution: r.institution?.name ?? 'Bank' });
      }
    }
    return out;
  }

  exchangePublicToken(publicToken: string) {
    return this.call<{ access_token: string; item_id: string }>('/item/public_token/exchange', {
      public_token: publicToken,
    });
  }

  syncTransactions(accessToken: string, cursor: string | null) {
    return this.call<SyncPage>('/transactions/sync', {
      access_token: accessToken,
      count: 100,
      ...(cursor ? { cursor } : {}),
    });
  }

  removeItem(accessToken: string) {
    return this.call<Record<string, unknown>>('/item/remove', { access_token: accessToken });
  }
}
