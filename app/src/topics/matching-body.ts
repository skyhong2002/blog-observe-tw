import * as cheerio from 'cheerio';

export const CLEANUP_VERSION = 'semantic-topic-body-v2';
const EXCLUDED_TOKENS = new Set([
  'share',
  'share-links',
  'social-share',
  'social-sharing',
  'share-buttons',
  'sharing',
  'sharedaddy',
  'jp-relatedposts',
  'yarpp',
  'yarpp-related',
  'related-posts',
  'related-articles',
  'related-content',
  'recommended-posts',
  'recommended-articles',
  'recommendations',
  'addtoany',
  'addtoany_share_save_container',
  'post-tags',
  'entry-tags',
  'tagcloud',
  'tag-cloud',
  'cat-links',
  'post-categories',
  'entry-categories',
  'post-meta',
  'entry-meta',
  'article-meta',
  'post-date',
  'entry-date',
  'published-date',
  'updated-date',
  'comments',
  'comment',
  'comment-list',
  'commentlist',
  'wp-block-comments',
  'wp-comments',
  'discussion',
  'comment-body',
  'comment-content',
  'blogroll',
  'blogroll-links',
  'linkcat',
  'sidebar',
  'widget-area',
  'site-sidebar',
]);
const SECTION_HEADING =
  /^(?:推薦文章|相關文章|延伸閱讀|更多文章|你可能也喜歡|您可能也喜歡|related (?:posts|articles)|recommended (?:posts|articles))\s*[:：]?$/iu;
const META_LINE =
  /^(?:發布(?:日期|時間)?|發表(?:日期|時間)?|更新(?:日期|時間)?|日期|分類|標籤|posted on|published on|categories|tags)\s*[:：]\s*[^\n]{0,160}$/iu;
const DATE_LINE = /^\s*(?:\d{4}[年/.-]\d{1,2}[月/.-]\d{1,2}日?)(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*$/u;
const normalizeSpace = (value: string) => value.replace(/\s+/gu, ' ').trim();

/** Only accepts a previously selected article-body fragment, never discovers body content in a full page. */
export function cleanTopicBody(input: { html?: string | null; text?: string | null }): {
  text: string;
  kind: 'html' | 'legacy-text' | 'none';
} {
  if (input.html?.trim()) {
    const $ = cheerio.load(input.html.slice(0, 2_000_000), {}, false);
    $(
      'script,style,noscript,template,iframe,svg,nav,aside,footer,form,[hidden],[aria-hidden="true"],[role="navigation"],[role="complementary"],[role="comment"],#disqus_thread,#comments,#respond,[rel~="tag"]',
    ).remove();
    // Exact tokens prevent WordPress body classes such as right-sidebar/tag-movie-comment from discarding the body.
    $('[class]').each((_, element) => {
      if (['body', 'article', 'main'].includes(element.tagName)) return;
      const tokens = ($(element).attr('class') ?? '').toLowerCase().split(/\s+/u);
      if (tokens.some((token) => EXCLUDED_TOKENS.has(token))) $(element).remove();
    });
    $('h1,h2,h3,h4,h5,h6').each((_, element) => {
      const heading = $(element);
      if (!SECTION_HEADING.test(normalizeSpace(heading.text()))) return;
      // Stripped HTML often retains only a heading and a list of article links. Only
      // consume link-dominated siblings; ordinary following prose starts a new body segment.
      let next = heading.next();
      while (next.length && !/^h[1-6]$/u.test(next[0].type === 'tag' ? next[0].name : '')) {
        const text = normalizeSpace(next.text());
        const linkText = normalizeSpace(next.find('a').addBack('a').text());
        if (text && (!linkText || linkText.length / text.length < 0.7)) break;
        const following = next.next();
        next.remove();
        next = following;
      }
      heading.remove();
    });
    $('time').each((_, element) => {
      const time = $(element),
        parent = time.parent();
      // An inline historical date remains article prose; a stand-alone timestamp is metadata.
      if (
        (DATE_LINE.test(normalizeSpace(time.text())) || Boolean(time.attr('datetime'))) &&
        (!parent.length || normalizeSpace(parent.text()) === normalizeSpace(time.text()))
      )
        time.remove();
    });
    $('p,div,li').each((_, element) => {
      const node = $(element);
      if (node.find('p,div,li,section,article').length) return;
      const text = normalizeSpace(node.text());
      if (META_LINE.test(text) || DATE_LINE.test(text)) node.remove();
    });
    $('br').replaceWith('\n');
    $('p,div,li,section,article,h1,h2,h3,h4,h5,h6,blockquote').append('\n');
    return { text: normalizeSpace($.root().text()), kind: 'html' };
  }
  if (input.text?.trim()) {
    // No markup means no safe way to identify related-link blocks. Remove only
    // independently delimited metadata lines; retain ordinary sentences verbatim.
    const lines = input.text
      .slice(0, 500_000)
      .split(/\r?\n/u)
      .filter((line) => !META_LINE.test(line.trim()) && !DATE_LINE.test(line.trim()));
    return { text: normalizeSpace(lines.join('\n')), kind: 'legacy-text' };
  }
  return { text: '', kind: 'none' };
}
