import { describe, expect, it } from 'vitest';
import { extractContent, inPublication, wordpressEvidence } from './article-content.ts';
import { CONTENT_VERSION, type ContentEvidence, MAX_CONTENT_HTML_BYTES } from './contracts.ts';
import { contentRequestPlan, inferredRule } from './registry.ts';
import { shouldReplaceContent } from './store.ts';

const evidence = (html: string, overrides: Partial<ContentEvidence> = {}): ContentEvidence => ({
  blogId: 1,
  blogUrl: 'https://writer.example/',
  articleUrl: 'https://writer.example/post',
  sourceUrl: 'https://writer.example/post',
  kind: 'article-html',
  html,
  ...overrides,
});
const extract = (e: ContentEvidence) => extractContent(e, inferredRule(1, e.blogUrl, e.html));
describe('platform content and provenance', () => {
  it.each([
    ['wordpress', 'https://writer.wordpress.com/', '<div class="entry-content">短文<a href="https://other.example/">另一站</a></div>'],
    ['blogger', 'https://writer.blogspot.com/', '<div class="post-body">短文</div>'],
    ['pixnet', 'https://writer.pixnet.net/', '<div class="article-content-inner">短文</div>'],
    ['medium', 'https://medium.com/@writer/', '<article><p>短文</p></article>'],
    ['substack', 'https://writer.substack.com/', '<div class="body markup"><p>短文</p></div>'],
    ['vocus', 'https://vocus.cc/salon/writer/', '<div class="ProseMirror"><p>短文</p></div>'],
    ['matters', 'https://matters.town/@writer/', '<div class="u-content">短文</div>'],
    ['hugo', 'https://writer.example/', '<meta name="generator" content="Hugo"><div class="post-content">短文</div>'],
    ['jekyll', 'https://writer.example/', '<meta name="generator" content="Jekyll"><div class="post-content">短文</div>'],
    ['generic', 'https://writer.example/', '<article>短文</article>'],
  ])('extracts %s without newspaper length gates', (platform, blogUrl, html) => {
    const result = extract(evidence(html, { blogUrl, articleUrl: blogUrl + 'post', sourceUrl: blogUrl + 'post' }));
    expect(result).toMatchObject({
      platform,
      status: 'ok',
      completeness: 'full',
      bodyText: '短文' + (platform === 'wordpress' ? '另一站' : ''),
    });
  });
  it('accepts full RSS tiny/image posts and keeps source coverage explicit', () => {
    for (const html of ['一字', '<img src="/photo.png" alt="照片">']) {
      const result = extract(evidence(html, { kind: 'rss-content', completeness: 'full', sourceUrl: 'https://writer.example/feed' }));
      expect(result.status).toBe('ok');
      expect(result.coverage).toBe('syndicated-body-only');
      expect(result.imageOnly).toBe(html.startsWith('<img'));
    }
  });
  it('marks explicit excerpt, paywall and upstream truncation partial without hard guessing from length', () => {
    expect(extract(evidence('短文', { kind: 'atom-content', completeness: 'unknown' })).status).toBe('partial');
    expect(extract(evidence('<p>短文</p><a href="/post">閱讀全文</a>', { kind: 'rss-content', completeness: 'full' })).status).toBe(
      'partial',
    );
    expect(extract(evidence('<article>訂閱後閱讀全文</article>')).reason).toBe('paywall');
    expect(extract(evidence('短文', { kind: 'rss-content', completeness: 'full', truncated: true })).completeness).toBe('partial');
  });
  it('caps HTML and records truncation rather than claiming complete coverage', () => {
    const e = evidence('<article>' + '字'.repeat(MAX_CONTENT_HTML_BYTES) + '</article>');
    expect(extract(e)).toMatchObject({ status: 'partial', truncated: true });
  });
  it('keeps exact non-body locations out of normalized body before removing attributes', () => {
    const result = extract(
      evidence(
        '<body class="right-sidebar"><article class="tag-movie-comment">正文<div class="sidebar">側欄</div><div class="blogroll">友站</div><div role="comment">留言</div><div class="sharedaddy">分享</div><div class="jp-relatedposts">相關</div></article></body>',
      ),
    );
    expect(result.bodyText).toBe('正文');
    expect(result.bodyHtml).not.toMatch(/側欄|友站|留言|分享|相關/);
  });
  it('strips executable attributes and unsafe URLs but retains usable citation URLs', () => {
    const result = extract(
      evidence(
        '<article onclick="bad()">正文<script>secret()</script><a href="javascript:bad()">Bad</a><a href="https://other.example/x" onmouseover="bad()">Other</a></article>',
      ),
    );
    expect(result.bodyHtml).not.toMatch(/script|onclick|onmouseover|javascript/);
    expect(result.bodyHtml).toContain('https://other.example/x');
  });
});
describe('identity and state transitions', () => {
  it.each(['https://other.example/post', 'https://writer.example/other'])('never assigns a different canonical article %s', (canonical) => {
    const result = extract(evidence(`<link rel="canonical" href="${canonical}"><article>訂閱後閱讀全文</article>`));
    expect(result).toMatchObject({ status: 'blocked', reason: 'article-identity-mismatch', bodyText: '' });
  });
  it('rejects same-publication redirect to homepage', () =>
    expect(extract(evidence('<article>首頁列表</article>', { sourceUrl: 'https://writer.example/' })).status).toBe('blocked'));
  it('keeps platform owners separate', () => {
    expect(inPublication('https://matters.town/@bob/post', 'https://matters.town/@alice')).toBe(false);
    expect(inPublication('https://note.com/alice/n/1', 'https://note.com/alice')).toBe(true);
  });
  it('binds JSON-LD fallback to this article instead of related item lists', () => {
    const data = {
      '@graph': [
        { '@type': 'BlogPosting', url: 'https://writer.example/other', articleBody: '錯文' },
        { '@type': 'BlogPosting', url: 'https://writer.example/post', articleBody: '短文' },
      ],
    };
    expect(extract(evidence(`<script type="application/ld+json">${JSON.stringify(data)}</script>`)).bodyText).toBe('短文');
  });
  it('retains full/newer snapshots over excerpts, failed extraction and old history entries', () => {
    const now = new Date('2026-01-02'),
      previous = { status: 'ok', completeness: 'full', obtainedAt: now, modifiedAt: now };
    const partial = evidence('摘要', { kind: 'rss-content', completeness: 'partial' });
    expect(shouldReplaceContent(previous, extract(partial), partial, now)).toBe(false);
    const older = evidence('<article>舊文</article>', { modifiedAt: new Date('2026-01-01') });
    expect(shouldReplaceContent(previous, extract(older), older, now)).toBe(false);
  });
  it('only plans a bounded public same-origin WordPress API then HTML fallback', () => {
    const rule = {
      ...inferredRule(1, 'https://writer.example/'),
      platform: 'wordpress',
      rules: { apiBase: 'https://writer.example/wp-json/' },
    };
    expect(contentRequestPlan('https://writer.example/post', rule)).toHaveLength(2);
    expect(contentRequestPlan('https://writer.example/post', { ...rule, rules: { apiBase: 'http://127.0.0.1/wp-json/' } })).toEqual([
      { url: 'https://writer.example/post', method: 'article-html' },
    ]);
    const base = {
      blogId: 1,
      blogUrl: 'https://writer.example/',
      articleUrl: 'https://writer.example/post',
      sourceUrl: 'https://writer.example/wp-json/wp/v2/posts',
    };
    expect(wordpressEvidence(JSON.stringify([{ link: 'https://writer.example/other', content: { rendered: '錯文' } }]), base)).toBeNull();
    expect(wordpressEvidence(JSON.stringify([{ link: base.articleUrl, content: { rendered: '全文', protected: true } }]), base)).toBeNull();
    expect(wordpressEvidence(JSON.stringify([{ link: base.articleUrl, content: { rendered: '全文' } }]), base)?.kind).toBe('wordpress-api');
    expect(CONTENT_VERSION).toBe('blog-content-v1');
  });
});

describe('Opus security regressions', () => {
  it('does not let a redirected different article self-attest by its own canonical', () => {
    const result = extract(
      evidence('<link rel="canonical" href="https://writer.example/other"><article>別篇正文</article>', {
        sourceUrl: 'https://writer.example/other',
      }),
    );
    expect(result).toMatchObject({ status: 'blocked', reason: 'article-identity-mismatch' });
  });
  it('allows equivalent transport/www/trailing slash without granting a different path', () => {
    expect(extract(evidence('<article>短文</article>', { sourceUrl: 'http://www.writer.example/post/' })).status).toBe('ok');
  });
  it('prioritizes full syndicated/API content over HTML without a body-length heuristic', () => {
    const now = new Date();
    const previous = { status: 'ok', completeness: 'full', sourceKind: 'rss-content', obtainedAt: now, modifiedAt: null };
    const html = evidence('<article>較長的HTML文字也不能覆蓋可信任的短RSS全文</article>');
    expect(shouldReplaceContent(previous, extract(html), html, now)).toBe(false);
  });
  it('keeps discussion/widgets and executable foreign markup out of stored fragments', () => {
    const result = extract(
      evidence(
        '<article>正文<div class="commentlist">評論</div><div class="wp-block-comments">留言</div><div id="disqus_thread">討論</div><svg><use href="javascript:alert(1)"></use></svg><div src="https://tracker.example/">一般文字</div></article>',
      ),
    );
    expect(result.bodyText).toBe('正文一般文字');
    expect(result.bodyHtml).not.toMatch(/javascript|svg|tracker|留言|評論/);
  });
  it('upgrades reusable sitemap HTML unknown-completeness only after semantic extraction', () => {
    expect(extract(evidence('<article>短文</article>', { completeness: 'unknown' })).status).toBe('ok');
    expect(extract(evidence('<nav>導覽</nav>', { completeness: 'unknown' })).status).toBe('missing');
  });
});

it('keeps Gamer owner publication identity separate from exact article sn identity', () => {
  const e = evidence('<article>另一篇</article>', {
    blogUrl: 'https://home.gamer.com.tw/homeindex.php?owner=alice',
    articleUrl: 'https://home.gamer.com.tw/creationDetail.php?owner=alice&sn=1',
    sourceUrl: 'https://home.gamer.com.tw/creationDetail.php?owner=alice&sn=2',
  });
  expect(extract({ ...e, sourceUrl: e.articleUrl }).status).toBe('ok');
  expect(extract(e).status).toBe('blocked');
});
