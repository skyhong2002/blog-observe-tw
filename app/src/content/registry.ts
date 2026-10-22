/** SourceSpec/registry pattern ported from tag.analysis.tw afe0a65, MIT Copyright (c) 2026 Sky Hong.
 * Rules are data, never page-provided executable code or arbitrary network endpoints. */
import { documentPlatform } from '../tech/platform.ts';
import { CONTENT_VERSION, type ContentRule, type ContentRules } from './contracts.ts';
export const ADAPTER_SELECTORS: Record<string, string[]> = {
  wordpress: ['.entry-content', '.wp-block-post-content', '.td-post-content', '.elementor-widget-theme-post-content'],
  blogger: ['.post-body', '.post-body.entry-content'],
  pixnet: ['.article-content-inner', '.article-content'],
  medium: ['article'],
  substack: ['.available-content .body', '.body.markup', '.post-content'],
  vocus: ['.editor-content', '.tiptap', '.ProseMirror', '[data-testid="article-content"]'],
  matters: ['.u-content', '.article-content', '[data-test-id="article-content"]'],
  hugo: ['.post-content', '.e-content', 'article .content'],
  jekyll: ['.post-content', '.e-content', 'article .content'],
  generic: [],
};
/**
 * The host decides for the hosted services; otherwise the page's own document does (tech/platform.ts, the Wappalyzer
 * rules). `html` must be a whole article page of the blog: leave it empty for a feed's content or a stored post body,
 * where another site's image or a quoted snippet of markup would say nothing about the blog.
 */
export function inferPlatform(url: string, html = ''): string {
  const host = new URL(url).hostname.toLowerCase();
  if (/(^|\.)blogspot\./.test(host)) return 'blogger';
  if (/(^|\.)pixnet\.net$/.test(host)) return 'pixnet';
  if (host === 'medium.com') return 'medium';
  if (/(^|\.)substack\.com$/.test(host)) return 'substack';
  if (host === 'vocus.cc') return 'vocus';
  if (/^matters\.(town|news)$/.test(host)) return 'matters';
  if (/(^|\.)wordpress\.com$/.test(host)) return 'wordpress';
  return (html && documentPlatform(url, html)) || 'generic';
}
export function inferredRule(blogId: number, url: string, html = ''): ContentRule {
  const platform = inferPlatform(url, html);
  return { blogId, platform, adapterId: `${platform}-public`, version: CONTENT_VERSION, rules: {}, revision: 1, source: 'inferred' };
}
export function validateRules(value: unknown): ContentRules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: ContentRules = {};
  for (const key of ['bodySelector', 'bodyExcludeSelector', 'apiBase'] as const) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === 'string' && raw.length <= 1000 && ![...raw].some((c) => c.charCodeAt(0) < 32)) result[key] = raw;
  }
  return result;
}
export type ContentRequest = { url: string; method: 'wordpress-api' | 'article-html' };
/** At most one public API and one HTML request. A REST endpoint is learned from publisher markup. */
export function contentRequestPlan(articleUrl: string, rule: ContentRule): ContentRequest[] {
  const out: ContentRequest[] = [];
  const article = new URL(articleUrl);
  if (rule.platform === 'wordpress' && rule.rules.apiBase) {
    try {
      const api = new URL(rule.rules.apiBase);
      if (api.origin === article.origin && /\/wp-json\/?$/.test(api.pathname) && !api.username && !api.password) {
        api.pathname = api.pathname.replace(/\/?$/, '/wp/v2/posts');
        api.search = '';
        const slug = article.pathname.split('/').filter(Boolean).at(-1);
        if (slug) {
          api.searchParams.set('slug', decodeURIComponent(slug));
          api.searchParams.set('per_page', '5');
          api.searchParams.set('_fields', 'link,content,modified_gmt,status');
          out.push({ url: api.href, method: 'wordpress-api' });
        }
      }
    } catch {
      /* Invalid inferred endpoint cannot introduce a new origin. */
    }
  }
  out.push({ url: articleUrl, method: 'article-html' });
  return out;
}
