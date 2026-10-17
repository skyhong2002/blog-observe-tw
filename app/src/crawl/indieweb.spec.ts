import { describe, expect, it } from 'vitest';
import { chineseContent, INDIEWEB_LISTING, indiewebListing, listingLabel, listingOf } from './directory-listing.ts';
import { indiewebMembers } from './indieweb.ts';

describe('IndieWeb wiki as a directory source', () => {
  it('reads member homes from User: links, lowercasing the MediaWiki-capitalized host', () => {
    const html = `<ul>
      <li><a href="/User:Tantek.com">tantek</a></li>
      <li><a href="/User:Www.jvt.me">jvt</a> <a href="/User:Www.jvt.me#about">again</a></li>
      <li><a href="/User:Example.org/blog">path</a></li>
      <li><a href="/User:NotADomain">nick</a> <a href="/chat-names">self</a> <a href="https://snarfed.org/">external</a></li>
    </ul>`;
    // A path is reduced to its publication home by the shared identity rule, as for every other source.
    expect(indiewebMembers(html).sort()).toEqual(['https://example.org/', 'https://tantek.com/', 'https://www.jvt.me/']);
  });
  it('counts only its own listing page, next to BlogBlog.Club', () => {
    const evidence = { indiewebListing: { page: INDIEWEB_LISTING } };
    expect(indiewebListing(evidence)).toBe(INDIEWEB_LISTING);
    expect(indiewebListing({ indiewebListing: { page: 'https://evil.test/chat-names' } })).toBeNull();
    expect(listingOf('indieweb-wiki', evidence)).toBe(INDIEWEB_LISTING);
    expect(listingOf('article-link', evidence)).toBeNull();
    expect(listingLabel('indieweb-wiki')).toBe('IndieWeb 名單自動收錄');
    expect(listingLabel('blogblog-club')).toBe('BlogBlog.Club 名單自動收錄');
  });
  it('keeps Chinese homes and leaves English or Japanese ones out', () => {
    expect(chineseContent('zh-Hant-TW', 'Hello')).toBe(true);
    expect(chineseContent('', `我的部落格，記錄生活與閱讀。${'今天去了市場買菜，順便散步回家。'.repeat(8)} RSS About`)).toBe(true);
    expect(chineseContent('en', 'Notes on the open web and owning your content. '.repeat(20))).toBe(false);
    expect(chineseContent('', `${'日本語の文章です。今日は雨でした。'.repeat(10)}`)).toBe(false);
    expect(chineseContent('ja', '漢字'.repeat(100))).toBe(false);
  });
});
