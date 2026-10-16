import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { type PersonalEvidence, personalHomepage } from '../ai/personal.ts';
import { type SitemapArticleEvidence, verifyArticleSitemap } from '../ai/publication-sitemap.ts';
import { identityKey, publicationDecision } from '../relations/identity.ts';
import { directoryListing } from './directory-listing.ts';
import { type FeedCrawlerOptions, isAllowedCrawlUrl, parseFeed, politeFetch, readFeedBody } from './feed.ts';
import { seedIdentityKey } from './seed-url-resolution.ts';
import { isSeedPlatformRoot, type SeedUrlValidation, validateSeedUrl } from './seed-url-validation.ts';

// v5 (2026-10-16): domain-named identities, listed homes' blog-section feeds, Hugo index.xml, stray feed items skipped.
export const CANDIDATE_POLICY = 'personal-rss-publication-v5-directory';
export type DiscoveryCandidate = {
  id: number;
  url: string;
  name: string | null;
  status: string;
  source_type: string;
  source_evidence?: unknown;
};
export type CandidateCheck = {
  policy: string;
  id: number;
  inputUrl: string;
  checkedAt: string;
  eligible: boolean;
  reason: string;
  verification?: SeedUrlValidation;
  enrichedName?: string;
  sitemapArticles?: SitemapArticleEvidence[];
  personalEvidence?: PersonalEvidence;
  /** The BlogBlog.Club page listing this publication (directory-listing.ts); stands in for personal-homepage proof. */
  directoryListing?: string;
  feed?: { url: string; type: 'rss' | 'atom' | 'sitemap'; title: string; identityUrl: string; entries: number; sample: string[] };
};
const platforms = new Set([
  'medium.com',
  'vocus.cc',
  'substack.com',
  'wordpress.com',
  'blogspot.com',
  'pixnet.net',
  'tumblr.com',
  'bearblog.dev',
  'github.io',
]);
const nonPublications = [
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'threads.net',
  'github.com',
  'wikipedia.org',
  'w3.org',
  'creativecommons.org',
  'discord.com',
  't.me',
  'line.me',
  'apple.com',
  'google.com',
  'amazon.com',
  'amazon.co.jp',
  'gumroad.com',
  'patreon.com',
  'ko-fi.com',
  'buymeacoffee.com',
];
export function candidatePreflight(candidate: DiscoveryCandidate): string | null {
  if (candidate.status !== 'candidate') return 'decision_already_exists';
  if (!isAllowedCrawlUrl(candidate.url) || candidate.url.length > 1024) return 'unsafe_or_invalid_url';
  const u = new URL(candidate.url);
  const host = u.hostname.replace(/^www\./, '');
  if (nonPublications.some((h) => host === h || host.endsWith(`.${h}`))) return 'not_a_blog_publication';
  const decision = publicationDecision(candidate.url);
  if (!decision.home)
    return decision.reason === 'shortener-unresolved'
      ? decision.reason
      : decision.reason === 'platform-root'
        ? 'platform_root'
        : 'not_a_blog_publication';
  // Platform owner homes are exact; article URLs and arbitrary query strings must not be admitted.
  const home = new URL(decision.home);
  const platformPath = home.pathname !== '/' || home.search;
  if (!platformPath && (isSeedPlatformRoot(candidate.url) || (platforms.has(host) && u.pathname === '/'))) return 'platform_root';
  if (platformPath) {
    if (
      identityKey(candidate.url) !== identityKey(decision.home) ||
      u.pathname.replace(/\/$/, '') !== home.pathname.replace(/\/$/, '') ||
      u.search !== home.search
    )
      return 'needs_publication_home';
  } else if (!/^\/(?:blog\/?|blogs\/?)?$/.test(u.pathname) || u.search) return 'needs_publication_home';
  if (!candidate.name?.trim()) return 'missing_identity_name';
  return null;
}
const array = (x: unknown): unknown[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const object = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
const normalized = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
/** Partial shared words are insufficient for unattended approval (Quill Writer != Another Writer). */
export function candidateIdentityConfirmed(
  name: string | null,
  verification: Pick<SeedUrlValidation, 'title' | 'siteName' | 'author'> & { finalUrl?: string | null },
  feedTitle: string,
): boolean {
  // A name that is (or contains) the publication's own domain, as in 「官大為的部落格 | Wiwi.Blog」, is confirmed when the
  // homepage and the feed both name that same domain; a domain is otherwise stripped from the name below.
  const host = verification.finalUrl ? new URL(verification.finalUrl).hostname.replace(/^www\./, '').toLowerCase() : '';
  const names = (text: string) => text.toLowerCase().includes(host);
  if (
    host.includes('.') &&
    names(name || '') &&
    names(feedTitle) &&
    [verification.title, verification.siteName, verification.author].some((text) => names(text))
  )
    return true;
  const identity = normalized((name || '').replace(/(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi, ''));
  if (
    identity.length < 2 ||
    (!/\p{Script=Han}/u.test(identity) && identity.length < 4) ||
    ['writer', 'author', 'blog', 'blogroll', 'blogger', 'wordpress', 'homepage', '網站', '部落格', '作者', '首頁'].includes(identity)
  )
    return false;
  return (
    [verification.title, verification.siteName, verification.author].some((text) => normalized(text).includes(identity)) &&
    normalized(feedTitle).includes(identity)
  );
}
export function publicationContains(value: string, home: string): boolean {
  try {
    if (!isAllowedCrawlUrl(value)) return false;
    const v = new URL(value),
      h = new URL(home);
    if (v.hostname.replace(/^www\./, '') !== h.hostname.replace(/^www\./, '')) return false;
    if (h.hostname === 'home.gamer.com.tw')
      return Boolean(h.searchParams.get('owner')) && v.searchParams.get('owner') === h.searchParams.get('owner');
    const path = h.pathname.replace(/\/$/, '');
    return !path || v.pathname === path || v.pathname.startsWith(`${path}/`);
  } catch {
    return false;
  }
}
/** Independent homepage name evidence plus an actual, non-empty RSS/Atom belonging to that publication. */
export async function validateCandidate(candidate: DiscoveryCandidate, options: FeedCrawlerOptions = {}): Promise<CandidateCheck> {
  const result: CandidateCheck = {
    policy: CANDIDATE_POLICY,
    id: candidate.id,
    inputUrl: candidate.url,
    checkedAt: new Date().toISOString(),
    eligible: false,
    reason: candidatePreflight(candidate) || 'unverified',
  };
  const listed = candidate.source_type === 'blogblog-club' ? directoryListing(candidate.source_evidence) : null;
  if (listed) result.directoryListing = listed;
  // Directory-listed homes are added without a name; like discovered links, they take the homepage's own.
  const mayEnrich = ['article-link', 'blogroll'].includes(candidate.source_type) || Boolean(listed);
  const personal = () => result.personalEvidence?.personal === true || Boolean(listed);
  const personalReason = (verified: string) => (result.personalEvidence?.personal === true ? verified : `${verified}_directory_listed`);
  if (result.reason !== 'unverified' && !(mayEnrich && result.reason === 'missing_identity_name')) return result;
  try {
    const home = await politeFetch(candidate.url, {}, options);
    if (!home.ok) {
      result.reason = `homepage_http_${home.status}`;
      await home.body?.cancel();
      return result;
    }
    const observed = personalHomepage(await readFeedBody(home));
    result.personalEvidence = observed.evidence;
    if (mayEnrich && !observed.siteName) {
      result.reason = 'missing_identity_name';
      return result;
    }
    if (mayEnrich && observed.siteName) {
      result.enrichedName = observed.siteName;
      candidate = { ...candidate, name: observed.siteName };
    }
  } catch (error) {
    result.reason = /robots/i.test(error instanceof Error ? error.message : '')
      ? 'robots_disallowed'
      : 'homepage_personal_verification_failed';
    return result;
  }
  const verification = await validateSeedUrl(
    { id: candidate.id, name: candidate.name!, url: candidate.url },
    { ...options, requireSyndication: false, maxSourceRequests: 8 },
  );
  result.verification = verification;
  if (!verification.validated || !verification.finalUrl) {
    result.reason = verification.reason;
    return result;
  }
  if (candidatePreflight({ ...candidate, url: verification.finalUrl })) {
    result.reason = 'redirect_not_publication_home';
    return result;
  }
  const source =
    verification.feedSources.find((s) => s.type === 'rss' || s.type === 'atom') ||
    verification.feedSources.find((s) => s.type === 'sitemap');
  if (!source) {
    result.reason = 'rss_or_article_sitemap_required';
    return result;
  }
  try {
    if (source.type === 'sitemap') {
      const title = verification.siteName || verification.title;
      if (!candidateIdentityConfirmed(candidate.name, verification, title)) {
        result.reason = 'sitemap_home_identity_mismatch';
        return result;
      }
      const articles = await verifyArticleSitemap(source.url, verification.finalUrl, options);
      if (!articles.length) {
        result.reason = 'rss_or_article_sitemap_required';
        return result;
      }
      result.sitemapArticles = articles;
      result.feed = {
        url: source.url,
        type: 'sitemap',
        title: title.slice(0, 255),
        identityUrl: verification.finalUrl,
        entries: articles.length,
        sample: articles.map((a) => a.url),
      };
      result.eligible = personal();
      result.reason = result.eligible
        ? personalReason('verified_personal_homepage_and_article_sitemap')
        : result.personalEvidence?.reason || 'personal_identity_uncertain';
      return result;
    }
    const response = await politeFetch(source.url, {}, options);
    if (!response.ok) {
      result.reason = `feed_http_${response.status}`;
      return result;
    }
    const xml = await readFeedBody(response);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
      result.reason = 'unsafe_xml';
      return result;
    }
    const root = object(new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(xml));
    const channel = object(object(root.rss).channel),
      atom = object(root.feed),
      meta = Object.keys(channel).length ? channel : atom;
    const title = typeof meta.title === 'string' ? meta.title.trim() : '';
    const finalFeed = new URL(response.url || source.url);
    if (
      /(?:^|\/)comments?(?:\/|$)/i.test(finalFeed.pathname) ||
      /^comments?(?:-|$)/i.test(finalFeed.searchParams.get('feed') || '') ||
      /^(?:comments? (?:on|for)\b)|comments? feed|(?:留言|評論)(?:摘要|訂閱|回應|feed)/i.test(title)
    ) {
      result.reason = 'comments_feed';
      return result;
    }

    const identities = array(meta.link).flatMap((l) =>
      typeof l === 'string'
        ? [l]
        : (!object(l)['@_rel'] || object(l)['@_rel'] === 'alternate') && typeof object(l)['@_href'] === 'string'
          ? [String(object(l)['@_href'])]
          : [],
    );
    // The feed names the publication home. For a home listed by BlogBlog.Club, a blog section of that same home
    // (wiwi.blog's feed names https://wiwi.blog/blog) also counts; any other home's category feed still does not.
    const identity = identities.find((u) => {
      try {
        const href = new URL(u, source.url).href;
        return (
          seedIdentityKey(href) === seedIdentityKey(verification.finalUrl!) ||
          (Boolean(listed) && publicationContains(href, verification.finalUrl!))
        );
      } catch {
        return false;
      }
    });
    if (!identity) {
      result.reason = 'feed_home_identity_mismatch';
      return result;
    }
    if (!candidateIdentityConfirmed(candidate.name, verification, title)) {
      result.reason = 'feed_name_identity_mismatch';
      return result;
    }
    const parsed = parseFeed(xml, response.url || source.url);
    // A title-less or self-pointing item (Hugo lists its /archives/ page) is skipped, not fatal; the feed must still
    // be articles: nine in ten items real posts.
    const entries = parsed.filter(
      (e) =>
        e.title.trim() &&
        e.title !== '未命名文章' &&
        seedIdentityKey(e.url) !== seedIdentityKey(source.url) &&
        seedIdentityKey(e.url) !== seedIdentityKey(verification.finalUrl!),
    );
    if (!entries.length || entries.length < 0.9 * parsed.length) {
      result.reason = 'empty_feed';
      return result;
    }
    if (entries.some((e) => !publicationContains(e.url, verification.finalUrl!))) {
      result.reason = 'feed_entries_outside_publication';
      return result;
    }
    result.feed = {
      url: response.url || source.url,
      type: source.type as 'rss' | 'atom',
      title: title.slice(0, 255),
      identityUrl: new URL(identity, source.url).href,
      entries: entries.length,
      sample: entries.slice(0, 3).map((e) => e.url),
    };
    result.eligible = personal();
    result.reason = result.eligible
      ? personalReason('verified_homepage_and_rss')
      : result.personalEvidence?.reason || 'personal_identity_uncertain';
  } catch (error) {
    const m = error instanceof Error ? error.message : '';
    result.reason = /robots/i.test(m)
      ? 'robots_disallowed'
      : /unsafe/i.test(m)
        ? 'unsafe_destination'
        : /timeout|aborted/i.test(m)
          ? 'timeout'
          : 'feed_verification_failed';
  }
  return result;
}
