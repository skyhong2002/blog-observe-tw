import * as cheerio from 'cheerio';

/** Trusted fetch/parse evidence, never accepted from scraper output. */
export type VocusArticleProof = { articleId: string; salonId: string; userId: string };
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
function parts(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'vocus.cc' && !u.port ? u.pathname.split('/').filter(Boolean) : [];
  } catch {
    return [];
  }
}
/** A candidate can be fetched for ownership verification; this does not authorize ingestion. */
export function vocusArticleCandidate(value: string, home: string) {
  const a = parts(value),
    h = parts(home);
  return a.length === 2 && a[0] === 'article' && hex(a[1]) && h.length === 2 && ['salon', 'user'].includes(h[0]) && hex(h[1]);
}
export function vocusProofMatches(proof: VocusArticleProof | undefined, articleUrl: string, home: string) {
  if (!proof || !vocusArticleCandidate(articleUrl, home)) return false;
  const a = parts(articleUrl),
    h = parts(home);
  return (
    hex(proof.articleId) &&
    hex(proof.salonId) &&
    hex(proof.userId) &&
    proof.articleId === a[1] &&
    (h[0] === 'salon' ? proof.salonId === h[1] : proof.userId === h[1])
  );
}
/** Read exact article metadata from Vocus SSR, or the same bounded metadata in our stored article wrapper. */
export function vocusProofFromHtml(html: string, articleUrl: string, home: string): VocusArticleProof | undefined {
  if (!vocusArticleCandidate(articleUrl, home)) return;
  try {
    const $ = cheerio.load(html);
    const data = JSON.parse($('script#__NEXT_DATA__').first().text());
    const a = data?.props?.pageProps?.parsedArticle;
    if (!a || a.salon?._id !== a.salonId) return;
    const proof = { articleId: a._id, salonId: a.salonId, userId: a.userId };
    return vocusProofMatches(proof, articleUrl, home) ? proof : undefined;
  } catch {
    return;
  }
}
