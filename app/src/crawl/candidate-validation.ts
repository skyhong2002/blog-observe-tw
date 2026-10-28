import * as cheerio from 'cheerio';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { type PersonalEvidence, personalAboutPage, personalHomepage } from '../ai/personal.ts';
import { type SitemapArticleEvidence, verifyArticleSitemap } from '../ai/publication-sitemap.ts';
import { identityKey, publicationDecision } from '../relations/identity.ts';
import type { AccountEvidence } from '../site-identity.ts';
import { CHINESE_ONLY_LISTINGS, chineseContent, listingOf } from './directory-listing.ts';
import { type FeedCrawlerOptions, isAllowedCrawlUrl, parseFeed, politeFetch, ROBOTS_UNREACHABLE, readFeedBody } from './feed.ts';
import { seedIdentityKey } from './seed-url-resolution.ts';
import { isSeedPlatformRoot, type SeedUrlValidation, validateSeedUrl } from './seed-url-validation.ts';

// v6 (2026-10-28): account-backed evidence, semantic home introductions and home-advertised feed identities.
export const CANDIDATE_POLICY = 'personal-rss-publication-v6-account-evidence';
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
  accountEvidence?: AccountEvidence;
  /** The BlogBlog.Club page listing this publication (directory-listing.ts); stands in for personal-homepage proof. */
  directoryListing?: string;
  feed?: {
    url: string;
    type: 'rss' | 'atom' | 'sitemap' | 'scraper';
    title: string;
    identityUrl: string;
    entries: number;
    sample: string[];
  };
  /** A validated generated scraper (app/src/scrapers) standing in for the missing feed; feed.type is 'scraper'. */
  scraper?: { id: number; codeSha256: string };
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
/** `/`, `/blog`, or a language home a site redirects to (thelingwu.com → /zh, /zh-tw/, /en/blog). */
const LANGUAGE_OR_BLOG_HOME = /^\/(?:[a-z]{2}(?:[-_][a-z]{2,4})?\/?)?(?:blogs?\/?)?$/i;
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
  } else if (!LANGUAGE_OR_BLOG_HOME.test(u.pathname) || u.search) return 'needs_publication_home';
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
const ABOUT_PATH = /^\/(?:about(?:[-_]?me)?|關於(?:我)?)\/?$/i;
const ABOUT_TEXT = /^(?:about(?: me)?|關於(?:我|本站)?)$/i;
/** The home's own about page: a same-publication link at /about/, /about-me/, /關於我/ or labelled About / 關於我. */
export function aboutPageUrl(html: string, home: string): string | null {
  const $ = cheerio.load(html);
  for (const el of $('a[href]').toArray()) {
    try {
      const url = new URL($(el).attr('href') || '', home);
      url.hash = '';
      let path = url.pathname;
      try {
        path = decodeURIComponent(path);
      } catch {}
      const named = ABOUT_PATH.test(path) || ABOUT_TEXT.test($(el).text().replace(/\s+/g, ' ').trim());
      if (named && !url.search && url.href !== new URL(home).href && publicationContains(url.href, home)) return url.href;
    } catch {}
  }
  return null;
}
/** The homepage itself named this source (head link or RSS button), as recorded by validateSeedUrl. */
export function advertisedSource(verification: Pick<SeedUrlValidation, 'evidence'>, url: string): boolean {
  return verification.evidence.sourceChecks.some((c) => c.advertised === true && (c.finalUrl || c.url) === url);
}
/** A homepage-advertised feed with a verified same-publication identity may use a different title. */
export function candidateFeedIdentityConfirmed(
  name: string | null,
  verification: Pick<SeedUrlValidation, 'title' | 'siteName' | 'author' | 'finalUrl' | 'evidence'>,
  title: string,
  feedUrl: string,
  identityUrl: string,
) {
  return (
    candidateIdentityConfirmed(name, verification, title) ||
    Boolean(
      title.trim() &&
        verification.finalUrl &&
        advertisedSource(verification, feedUrl) &&
        publicationContains(identityUrl, verification.finalUrl),
    )
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
export async function validateCandidate(
  candidate: DiscoveryCandidate,
  options: FeedCrawlerOptions & { accountEvidence?: AccountEvidence } = {},
): Promise<CandidateCheck> {
  const result: CandidateCheck = {
    policy: CANDIDATE_POLICY,
    id: candidate.id,
    inputUrl: candidate.url,
    checkedAt: new Date().toISOString(),
    eligible: false,
    reason: candidatePreflight(candidate) || 'unverified',
  };
  let listed = listingOf(candidate.source_type, candidate.source_evidence);
  if (listed) result.directoryListing = listed;
  // Directory-listed homes and reader suggestions are added without a name; like discovered links, they take the homepage's own.
  const mayEnrich =
    ['article-link', 'blogroll', 'reader-suggestion', 'blogblog-club', 'indieweb-wiki', 'indieping'].includes(candidate.source_type) ||
    Boolean(listed);
  if (options.accountEvidence && seedIdentityKey(options.accountEvidence.home) === seedIdentityKey(candidate.url))
    result.accountEvidence = options.accountEvidence;
  const personal = () =>
    result.personalEvidence?.reason !== 'organization_media_or_shop_evidence' &&
    (result.personalEvidence?.personal === true || Boolean(listed) || Boolean(result.accountEvidence));
  const personalReason = (verified: string) =>
    result.accountEvidence
      ? `${verified}_account_${result.accountEvidence.kind}`
      : result.personalEvidence?.personal === true
        ? verified
        : `${verified}_directory_listed`;
  // A homepage that proves nothing (Blowfish's profile home: a name and a one-line title) may introduce its owner on
  // its own about page: one more same-publication request, made only once a feed or article sitemap is found.
  let aboutUrl: string | null = null;
  const aboutProof = async (home: string) => {
    if (personal() || result.personalEvidence?.reason !== 'personal_identity_uncertain' || !aboutUrl) return;
    if (!publicationContains(aboutUrl, home)) return;
    try {
      const page = await politeFetch(aboutUrl, {}, options);
      if (!page.ok) {
        await page.body?.cancel();
        return;
      }
      const about = personalAboutPage(await readFeedBody(page));
      if (about.personal) result.personalEvidence = { ...about, page: aboutUrl };
    } catch {
      // The homepage evidence stands; the about page is only a second chance.
    }
  };
  if (result.reason !== 'unverified' && !(mayEnrich && result.reason === 'missing_identity_name')) return result;
  try {
    const home = await politeFetch(candidate.url, {}, options);
    if (!home.ok) {
      result.reason = `homepage_http_${home.status}`;
      await home.body?.cancel();
      return result;
    }
    const html = await readFeedBody(home);
    // IndieWeb and IndiePing members are listed only when their home is in Chinese; others stay ordinary candidates.
    if (CHINESE_ONLY_LISTINGS.has(candidate.source_type)) {
      const $ = cheerio.load(html);
      $('script,style,noscript,template').remove();
      if (!chineseContent($('html').attr('lang') || '', $('body').text().slice(0, 20000))) {
        delete result.directoryListing;
        listed = null;
        if (!result.accountEvidence) {
          result.reason = candidate.source_type === 'indieping' ? 'indieping_listing_not_chinese' : 'indieweb_listing_not_chinese';
          return result;
        }
      }
    }
    const observed = personalHomepage(html);
    result.personalEvidence = observed.evidence;
    aboutUrl = aboutPageUrl(html, home.url || candidate.url);
    if (mayEnrich && !observed.siteName) {
      result.reason = 'missing_identity_name';
      return result;
    }
    if (mayEnrich && observed.siteName) {
      result.enrichedName = observed.siteName;
      candidate = { ...candidate, name: observed.siteName };
    }
  } catch (error) {
    const m = error instanceof Error ? error.message : '';
    result.reason = m.includes(ROBOTS_UNREACHABLE)
      ? 'robots_unreachable'
      : /robots/i.test(m)
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
  if (result.accountEvidence && seedIdentityKey(result.accountEvidence.home) !== seedIdentityKey(verification.finalUrl))
    delete result.accountEvidence;
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
      await aboutProof(verification.finalUrl);
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
    // The feed names the publication home. A blog section of that same home (wiwi.blog's feed names
    // https://wiwi.blog/blog, a Hugo /posts/index.xml names /posts/) also counts when BlogBlog.Club lists the home or
    // the homepage itself links that feed; a category feed the homepage never names still does not.
    const sectionAllowed = Boolean(listed) || advertisedSource(verification, source.url);
    const identity = identities.find((u) => {
      try {
        const href = new URL(u, source.url).href;
        return (
          seedIdentityKey(href) === seedIdentityKey(verification.finalUrl!) ||
          (sectionAllowed && publicationContains(href, verification.finalUrl!))
        );
      } catch {
        return false;
      }
    });
    if (!identity) {
      result.reason = 'feed_home_identity_mismatch';
      return result;
    }
    if (!candidateFeedIdentityConfirmed(candidate.name, verification, title, source.url, new URL(identity, source.url).href)) {
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
    await aboutProof(verification.finalUrl);
    result.eligible = personal();
    result.reason = result.eligible
      ? personalReason('verified_homepage_and_rss')
      : result.personalEvidence?.reason || 'personal_identity_uncertain';
  } catch (error) {
    const m = error instanceof Error ? error.message : '';
    result.reason = m.includes(ROBOTS_UNREACHABLE)
      ? 'robots_unreachable'
      : /robots/i.test(m)
        ? 'robots_disallowed'
        : /unsafe/i.test(m)
          ? 'unsafe_destination'
          : /timeout|aborted/i.test(m)
            ? 'timeout'
            : 'feed_verification_failed';
  }
  return result;
}
