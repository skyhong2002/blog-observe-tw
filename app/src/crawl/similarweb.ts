export type SimilarWebOptions = {
  enabled?: boolean;
};
export type SimilarWebResult = {
  enabled: boolean;
  domain: string;
  candidates: string[];
  status: 'disabled' | 'awaiting-contract';
};

/**
 * The approved integration uses tag as the only provider client. Its API and
 * authentication contract are still pending, so neither branch performs I/O.
 * Legacy provider endpoints, budgets, locks and environment flags are retired.
 * Enabling this placeholder only reports readiness; it cannot produce candidates.
 */
export async function discoverSimilarSites(domain: string, options: SimilarWebOptions = {}): Promise<SimilarWebResult> {
  const enabled = options.enabled === true;
  return {
    enabled,
    domain: domain
      .trim()
      .toLowerCase()
      .replace(/^www\./, ''),
    candidates: [],
    status: enabled ? 'awaiting-contract' : 'disabled',
  };
}
