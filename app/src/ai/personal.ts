import * as cheerio from 'cheerio';
import { normalizeInput } from './contracts.ts';
import {
  firstPersonIntroduction,
  OWNERSHIP_VERSION,
  organizationEvidence,
  ownerIntroduction,
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
  /** The home's own about page the snippet was read from; absent when it came from the homepage. */
  page?: string;
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
  // A homepage's own bio/intro block (`.bio`, `#about`, CSS-module names like `Home_bio__x1`) counts only
  // when it is written in the first person, is not about an author/user/member, and is the page's only one.
  const introToken = /(?:^|[-_])(?:bio|intro|about|profile)(?:[-_]|$)/i;
  const peopleToken = /author|user|member|byline|comment|team|staff/i;
  const tokens = (el: Parameters<typeof $>[0]) => [$(el).attr('id') || '', ...($(el).attr('class') || '').split(/\s+/)];
  const introBlocks = $('[id],[class]')
    .toArray()
    .filter((el) => !['html', 'body'].includes(el.tagName) && tokens(el).some((t) => introToken.test(t)))
    .filter((el) => ![el, ...$(el).parents().toArray()].some((node) => tokens(node).some((t) => peopleToken.test(t))));
  const introTexts = [
    ...new Set(
      introBlocks
        // The outermost block of a nested intro/bio pair holds all of it.
        .filter(
          (el) =>
            !$(el)
              .parents()
              .toArray()
              .some((parent) => introBlocks.includes(parent)),
        )
        .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
        .filter(firstPersonIntroduction),
    ),
  ];
  // A homepage hero can use arbitrary CSS classes. Only paragraphs beside its sole h1 qualify;
  // article lists, member profiles and author bylines cannot contribute ownership evidence.
  const headings = $('h1')
    .toArray()
    .filter(
      (el) =>
        ![el, ...$(el).parents().toArray()].some((node) =>
          tokens(node).some((t) => /(?:post|entry|article|author|user|member|team|staff|byline)/i.test(t)),
        ),
    );
  const leadTexts =
    headings.length === 1
      ? $(headings[0])
          .parent()
          .children('p')
          .toArray()
          .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
          .filter(firstPersonIntroduction)
      : [];
  const identityRegions = [
    description,
    ...regions.map((el) => $(el).text()),
    ...(introTexts.length === 1 ? introTexts : []),
    ...(leadTexts.length === 1 ? leadTexts : []),
  ];
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
  const identitySnippet = ownershipSegments(input)!.find(ownerIntroduction);
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
            ? selfDescription(identitySnippet!)
              ? 'explicit_personal_self_description'
              : 'first_person_site_introduction'
            : 'personal_identity_uncertain',
    } as PersonalEvidence,
  };
}
/**
 * A home's own about page (Hugo Blowfish's profile home shows only a name and a title; 「我是 Luke……」 is on /about/):
 * the paragraphs of its content before the first section heading, read as one site introduction under the same
 * first-person and organization rules. Résumé sections, comments and a page without a content region never count.
 */
export function personalAboutPage(html: string): PersonalEvidence {
  const $ = cheerio.load(html);
  $('script,style,noscript,nav,footer,header,aside,form,details').remove();
  const root = $('[itemprop="articleBody"],.article-content,.entry-content,.post-content,article,main').first();
  const paragraphs: string[] = [];
  for (const el of root.find('p,h1,h2,h3,h4,h5,h6').toArray()) {
    if (el.tagName !== 'p') {
      if (paragraphs.length) break;
      continue;
    }
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
  }
  const intro = normalizeInput(paragraphs.join(' ')).slice(0, 1000);
  const excluded = organizationEvidence(intro);
  const input = ownershipInput(intro && !excluded ? [intro] : []);
  const identitySnippet = ownershipSegments(input)!.find(ownerIntroduction);
  const personal = Boolean(identitySnippet);
  return {
    method: personal ? 'deterministic' : 'unresolved',
    input,
    ownershipVersion: OWNERSHIP_VERSION,
    identitySnippet,
    personal,
    reason: excluded
      ? 'organization_media_or_shop_evidence'
      : personal
        ? selfDescription(identitySnippet!)
          ? 'about_page_personal_self_description'
          : 'about_page_first_person_introduction'
        : 'personal_identity_uncertain',
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
    ownerIntroduction(e.identitySnippet) &&
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
