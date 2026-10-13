import { compilePublicationAliases, identityKey, normalizeLink, type PublicationAlias, publicationHome } from './identity.ts';

export type StoredAliasEvidence = {
  kind: 'redirect' | 'ownership';
  from: string;
  to: string;
  sourceUrl: string;
  observedAt: string;
  verified: true;
};
/** Caller supplies already verified stored observations, never unverified candidates.
 * No fetch: a redirect proves one URL only; explicit ownership may prove a publication home.
 * Different registered publications are never merged through this helper.
 */
export function aliasesFromStoredEvidence(
  records: readonly StoredAliasEvidence[],
  current: PublicationAlias[],
  now = new Date(),
): PublicationAlias[] {
  const resolver = compilePublicationAliases(current),
    result: PublicationAlias[] = [];
  for (const record of records.slice(0, 100)) {
    const from = normalizeLink(record.from),
      to = normalizeLink(record.to);
    const observed = Date.parse(record.observedAt);
    if (
      record.verified !== true ||
      !from ||
      !to ||
      !normalizeLink(record.sourceUrl) ||
      !Number.isFinite(observed) ||
      observed > now.getTime()
    )
      continue;
    const target = resolver.resolve(to),
      existing = resolver.resolve(from);
    if (!target || (existing !== null && existing !== target)) continue;
    if (record.kind === 'redirect') result.push({ blogId: target, url: from, scope: 'exact-url' });
    else if (record.kind === 'ownership') {
      const home = publicationHome(from);
      if (home && identityKey(home) === identityKey(from)) result.push({ blogId: target, url: from, scope: 'publication-prefix' });
    }
  }
  return result;
}
