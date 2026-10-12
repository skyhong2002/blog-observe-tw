export type TagRequestKind = 'traffic' | 'similar_sites';
export type TagRequestStatus = 'pending' | 'ok' | 'no-data' | 'blocked';
export type TagSimilarSitesPayload = {
  domain: string;
  source: 'similarweb-extension';
  fetchedAt: string | null;
  requests: Array<{ kind: TagRequestKind; status: TagRequestStatus; requestedAt: string; attempts: number; nextAttemptAt: string | null }>;
  traffic: {
    monthly: Array<{ month: string; visits: number }>;
    globalRank: number | null;
    countryRank: { code: string; rank: number } | null;
    category: string | null;
    topCountries: Array<{ code: string; share: number }>;
  } | null;
  similarSites: string[];
};
export type SimilarWebResult = {
  enabled: boolean;
  domain: string;
  candidates: string[];
  status: 'disabled' | 'awaiting-contract' | 'ready' | 'pending' | 'blocked' | 'no-data' | 'not-requested' | 'error' | 'auth' | 'config';
  httpStatus?: number;
  fetchedAt?: string | null;
  nextAttemptAt?: string | null;
  created?: boolean;
  /** Validated public tag API response, never request headers or credentials. */
  sourceEvidence?: TagSimilarSitesPayload;
  errorCode?: 'invalid-domain' | 'invalid-kind' | 'invalid-response' | 'request-failed' | 'token-unavailable';
};
export interface TagSimilarSitesClient {
  getResult(domain: string): Promise<SimilarWebResult>;
  submit(domain: string, kind?: TagRequestKind): Promise<SimilarWebResult>;
}
export type SimilarWebOptions = {
  enabled?: boolean;
  /** Only supplied by the caller after its persistent budget/poll checks. */
  client?: TagSimilarSitesClient;
};

/** No implicit submission, environment activation, provider request or filesystem lock. */
export async function discoverSimilarSites(domain: string, options: SimilarWebOptions = {}): Promise<SimilarWebResult> {
  const enabled = options.enabled === true;
  const clean = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  if (!enabled || !options.client) return { enabled, domain: clean, candidates: [], status: enabled ? 'awaiting-contract' : 'disabled' };
  return options.client.getResult(domain);
}
