import { describe, expect, it } from 'vitest';
import { vocusArticleCandidate, vocusProofFromHtml, vocusProofMatches } from './vocus-publication.ts';

const articleId = '111111111111111111111111';
const salonId = '222222222222222222222222';
const userId = '333333333333333333333333';
const otherId = '444444444444444444444444';
const article = `https://vocus.cc/article/${articleId}`;
const salon = `https://vocus.cc/salon/${salonId}`;
const user = `https://vocus.cc/user/${userId}`;
const proof = { articleId, salonId, userId };
const ssr = (parsedArticle: unknown) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { parsedArticle } } })}</script>`;
const metadata = { _id: articleId, salonId, userId, salon: { _id: salonId } };

describe('Vocus article ownership evidence', () => {
  it.each([salon, user])('accepts exact article metadata for its publication %s', (home) => {
    expect(vocusArticleCandidate(article, home)).toBe(true);
    expect(vocusProofFromHtml(ssr(metadata), article, home)).toEqual(proof);
    expect(vocusProofMatches(proof, article, home)).toBe(true);
  });

  it.each([
    { ...metadata, _id: otherId },
    { ...metadata, salonId: otherId, salon: { _id: otherId } },
    { ...metadata, salon: { _id: otherId } },
    { ...metadata, salon: undefined },
    { ...metadata, userId: undefined },
    { ...metadata, userId: 'not-an-id' },
    undefined,
  ])('rejects mismatched or incomplete SSR metadata %#', (value) => {
    expect(vocusProofFromHtml(ssr(value), article, salon)).toBeUndefined();
  });

  it('requires the user identity for user publications', () => {
    expect(vocusProofFromHtml(ssr({ ...metadata, userId: otherId }), article, user)).toBeUndefined();
    expect(vocusProofMatches({ ...proof, userId: otherId }, article, user)).toBe(false);
  });

  it.each([
    `https://other.test/article/${articleId}`,
    `https://vocus.cc:8443/article/${articleId}`,
    `http://vocus.cc/article/${articleId}`,
    `https://vocus.cc.evil.test/article/${articleId}`,
    `https://vocus.cc/article/${articleId}/extra`,
    'https://vocus.cc/article/not-an-id',
  ])('rejects article origins and paths outside the proof boundary: %s', (url) => {
    expect(vocusArticleCandidate(url, salon)).toBe(false);
    expect(vocusProofFromHtml(ssr(metadata), url, salon)).toBeUndefined();
    expect(vocusProofMatches(proof, url, salon)).toBe(false);
  });

  it.each([`https://other.test/salon/${salonId}`, `https://vocus.cc:8443/salon/${salonId}`])(
    'rejects publication origins outside Vocus: %s',
    (home) => expect(vocusArticleCandidate(article, home)).toBe(false),
  );

  it('does not infer proof from visible claims, malformed JSON, or missing metadata', () => {
    for (const html of ['<p>I own this salon</p>', '<script id="__NEXT_DATA__">{</script>', ssr({})]) {
      expect(vocusProofFromHtml(html, article, salon)).toBeUndefined();
    }
  });
});
