import * as cheerio from 'cheerio';
import { normalizeInput } from './contracts.ts';
import {
  OWNERSHIP_VERSION,
  organizationEvidence,
  ownershipInput,
  ownershipQuotes,
  ownershipSegments,
  selfDescription,
} from './ownership.ts';
export type PersonalEvidence = {
  method: 'deterministic' | 'ai' | 'unresolved';
  input: string;
  ownershipVersion?: string;
  /** Explicit site-level description/about introduction; never an article/comment excerpt. */
  identitySnippet?: string;
  personal: boolean;
  reason: string;
  cacheKey?: string;
};
/** Deterministic evidence must come from a site-level introduction, not a post teaching blogging. */
export function personalHomepage(html: string) {
  const $ = cheerio.load(html);
  $('script,style,noscript,nav,footer').remove();
  const siteName = $('head meta[property="og:site_name"]').attr('content') || $('head title').text();
  const description = $('head meta[name="description"]').attr('content') || '';
  // Remove excerpts, discussions and sidebars before selecting a site's own explicit introductory region.
  $(
    'article,[role="article"],[itemtype*="Article"],[itemprop="articleBody"],.post,.entry,.hentry,.entry-content,.post-content,aside,form',
  ).remove();
  // Match comment containers, not unrelated body classes such as tag-movie-comment or with-comments.
  $('[id],[class]')
    .filter((_, el) => {
      if (['html', 'body'].includes(el.tagName)) return false;
      const tokens = [$(el).attr('id') || '', ...($(el).attr('class') || '').split(/\s+/)];
      return tokens.some((token) =>
        /^(?:comments?(?:$|[-_])|commentlist$|disqus(?:$|[-_])|respond$|wp[-_](?:block[-_])?comments?(?:$|[-_])|discussion(?:$|[-_]))/i.test(
          token,
        ),
      );
    })
    .remove();
  // Only explicitly named regions directly in the site shell/header qualify. Unknown
  // deep user/profile containers are not ownership proof even if they use an author-bio class.
  const trustedPosition = (el: Parameters<typeof $>[0]) => {
    const parents = $(el).parents().toArray();
    return parents.every(
      (parent) =>
        ['html', 'body', 'header'].includes(parent.tagName) ||
        $(parent).is('#page,#site,.site,.site-wrapper,.site-container,.site-header,.site-branding,.site-identity'),
    );
  };
  const regions = $('.site-description,.site-tagline,#about-me,.about-me,.author-bio,[data-site-introduction]')
    .toArray()
    .filter(trustedPosition);
  const identityRegions = [description, ...regions.map((el) => $(el).text())];
  // Exclusions inspect every complete trusted region BEFORE byte/segment bounds, so
  // a late editorial/team notice cannot disappear behind a truncated personal bio.
  const excluded = [siteName, ...identityRegions].some(organizationEvidence);
  const authorBios = new Set(
    regions
      .filter((el) => $(el).is('.author-bio'))
      .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );
  const ambiguousAuthors = authorBios.size > 1;
  // siteName remains homepage identity context in the return value; it cannot by
  // itself prove ownership. These are website excerpts, not generated prompt labels.
  const input = ownershipInput(
    excluded || ambiguousAuthors ? [] : identityRegions.map((s) => normalizeInput(s.replace(/\s+/g, ' ').trim())),
  );
  const identitySnippet = ownershipSegments(input)!.find(selfDescription);
  const personal = Boolean(identitySnippet);
  return {
    siteName: siteName.trim().slice(0, 255),
    evidence: {
      method: personal ? 'deterministic' : 'unresolved',
      input,
      ownershipVersion: OWNERSHIP_VERSION,
      identitySnippet,
      personal,
      reason: excluded
        ? 'organization_media_or_shop_evidence'
        : ambiguousAuthors
          ? 'multiple_author_identities'
          : personal
            ? 'explicit_personal_self_description'
            : 'personal_identity_uncertain',
    } as PersonalEvidence,
  };
}
export function deterministicPersonalProof(e: PersonalEvidence) {
  return (
    e.method === 'deterministic' &&
    e.personal &&
    typeof e.identitySnippet === 'string' &&
    e.identitySnippet.length <= 1000 &&
    validOwnershipEvidence(e) &&
    ownershipSegments(e.input)!.some((segment) => segment === e.identitySnippet) &&
    selfDescription(e.identitySnippet) &&
    !organizationEvidence(e.input)
  );
}

export function validOwnershipEvidence(e: PersonalEvidence) {
  return e.ownershipVersion === OWNERSHIP_VERSION && ownershipSegments(e.input) !== null;
}
export function aiPersonalProof(e: PersonalEvidence, result: Record<string, unknown>) {
  return (
    validOwnershipEvidence(e) &&
    result.classification === 'personal' &&
    typeof result.confidence === 'number' &&
    result.confidence >= 0.95 &&
    ownershipQuotes(e.input, result.quotedEvidence)
  );
}
