import { describe, expect, it } from 'vitest';
import { cleanTopicBody } from './matching-body.ts';

describe('semantic article matching input cleanup', () => {
  it('removes exact-token boilerplate while keeping ordinary recommendations in prose', () => {
    const result = cleanTopicBody({
      html: `<article class="tag-movie-comment right-sidebar"><p>我推薦這本書，花時間理解穩定性與 AI 模型。</p><div class="sharedaddy">Facebook 分享</div><div class="jp-relatedposts">推薦文章 推薦 推薦</div><div class="post-tags">旅行 時間</div><aside>相關文章</aside><div class="comments">AI 留言</div><p class="entry-date">2026-10-12</p></article>`,
    });
    expect(result).toEqual({ kind: 'html', text: '我推薦這本書，花時間理解穩定性與 AI 模型。' });
  });
  it('cleans stripped related-post headings plus link lists but stops before ordinary prose', () => {
    const result = cleanTopicBody({
      html: '<p>文章正文</p><h3>相關文章</h3><ul><li><a href="/a">金融推薦</a></li><li><a href="/b">年度排行</a></li></ul><p>我推薦繼續花時間思考這個問題。</p><h2>後記</h2><p>正文的延伸。</p>',
    });
    expect(result.text).toBe('文章正文 我推薦繼續花時間思考這個問題。 後記 正文的延伸。');
  });
  it('does not treat substring classes or prose mentioning 相關文章 as boilerplate', () => {
    expect(
      cleanTopicBody({
        html: '<div class="right-sidebar ast-no-sidebar tag-movie-comment"><p>推薦文章的演算法值得研究。</p><h2>為什麼需要相關文章推薦</h2><p>與本篇相關文章有助理解。</p></div>',
      }).text,
    ).toBe('推薦文章的演算法值得研究。 為什麼需要相關文章推薦 與本篇相關文章有助理解。');
  });
  it('removes stand-alone metadata timestamps and classification rows, retaining inline historical dates', () => {
    expect(
      cleanTopicBody({
        html: '<p><time datetime="2026-10-12">2026-10-12</time></p><p>分類：旅行、生活</p><p>發布時間：2026-10-12 10:20</p><p>我在 <time>2026-10-12</time> 記下這段旅程。</p>',
      }).text,
    ).toBe('我在 2026-10-12 記下這段旅程。');
  });
  it('does not restore raw text when HTML cleanup yields nothing', () => {
    expect(cleanTopicBody({ html: '<aside>noise</aside>', text: 'noise' })).toEqual({ text: '', kind: 'html' });
  });
  it('marks legacy text separately and conservatively removes only metadata lines', () => {
    expect(cleanTopicBody({ text: '2026-10-12\n分類：科技\n我推薦花時間了解 AI。\n相關文章\n文字沒有結構不可硬刪' })).toEqual({
      kind: 'legacy-text',
      text: '我推薦花時間了解 AI。 相關文章 文字沒有結構不可硬刪',
    });
    expect(cleanTopicBody({})).toEqual({ kind: 'none', text: '' });
  });
});
