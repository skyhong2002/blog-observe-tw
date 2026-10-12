import * as cheerio from 'cheerio';
import { normalizeInput } from './contracts.ts';
export type PersonalEvidence = {
  method: 'deterministic' | 'ai' | 'unresolved';
  input: string;
  /** Explicit site-level description/about introduction; never an article/comment excerpt. */
  identitySnippet?: string;
  personal: boolean;
  reason: string;
  cacheKey?: string;
};
const excludedPattern = /新聞(?:媒體|網)|編輯(?:部|團隊)|購物車|加入購物車|企業官方|公司官網|newsroom|add to cart|corporate blog/i;
function selfDescription(text: string) {
  return (
    /個人(?:的)?部落格|私人(?:的)?部落格|personal blog|個人網站|個人網誌/i.test(text) &&
    /我是[^。，\n]{2,40}|我叫[^。，\n]{2,30}|I(?:'m| am) [A-Z][\w -]{2,40}|關於我|about me/i.test(text) &&
    !excludedPattern.test(text)
  );
}
/** Deterministic evidence must come from a site-level introduction, not a post teaching blogging. */
export function personalHomepage(html: string) {
  const $ = cheerio.load(html);
  $('script,style,noscript,nav,footer').remove();
  const text = $('main').text() || $('body').text();
  const siteName = $('meta[property="og:site_name"]').attr('content') || $('title').text();
  const description = $('meta[name="description"]').attr('content') || '';
  // Remove excerpts, discussions and sidebars before selecting a site's own explicit introductory region.
  $('article,[role="article"],.post,.entry,.hentry,.comments,#comments,[class*="comment"],aside,form').remove();
  const identityRegions = [
    description,
    ...$('.site-description,.site-tagline,#about-me,.about-me,.author-bio,[data-site-introduction]')
      .toArray()
      .map((el) => $(el).text()),
  ]
    .map((s) => normalizeInput(s.replace(/\s+/g, ' ').trim()))
    .filter((s) => s.length > 0 && s.length <= 1000);
  const identitySnippet = identityRegions.find(selfDescription);
  const input = normalizeInput(
    `Site name: ${siteName}\nSite description: ${description}\nSite introduction: ${identityRegions.join('\n')}\nPage text (may contain articles, not proof of ownership): ${text.replace(/\s+/g, ' ').trim()}`,
  );
  const excluded = excludedPattern.test(input);
  const personal = Boolean(identitySnippet) && !excluded;
  return {
    siteName: siteName.trim().slice(0, 255),
    evidence: {
      method: personal ? 'deterministic' : 'unresolved',
      input,
      identitySnippet,
      personal,
      reason: excluded
        ? 'organization_media_or_shop_evidence'
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
    e.input.includes(e.identitySnippet) &&
    selfDescription(e.identitySnippet) &&
    !excludedPattern.test(e.input)
  );
}
