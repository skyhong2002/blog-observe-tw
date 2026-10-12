/** Pure JSON-LD entity selection copied from tag.analysis.tw afe0a65.
 * MIT Copyright (c) 2026 Sky Hong. Blog adaptations preserve short/image posts. */
import type * as cheerio from 'cheerio';

type JsonNode = Record<string, unknown>;
const urlKey = (value: string) => {
  try {
    const u = new URL(value);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return value;
  }
};
export function articleNodes($: cheerio.CheerioAPI, url: string): JsonNode[] {
  const found: JsonNode[] = [];
  // Visit only structural containers for the page entity. Related ItemList
  // entries can contain perfectly valid NewsArticles belonging to other URLs.
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as JsonNode;
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.some((type) => typeof type === 'string' && /(?:^|[/#])(?:\w*Article|BlogPosting|LiveBlogPosting)$/.test(type))) {
      found.push(node);
    }
    visit(node['@graph']);
    visit(node.mainEntity);
  };
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      visit(JSON.parse($(script).text()));
    } catch {
      // Malformed structured data must not prevent the DOM fallback.
    }
  }
  const canonical = $('link[rel="canonical"]').first().attr('href');
  const keys = new Set([urlKey(url)]);
  if (canonical) {
    try {
      keys.add(urlKey(new URL(canonical, url).href));
    } catch {
      // A malformed canonical must not discard the requested URL identity.
    }
  }
  const identity = (node: JsonNode): string[] => {
    const values = [node.url, node['@id'], node.mainEntityOfPage];
    return values.flatMap((value) => {
      const raw = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as JsonNode)['@id'] : null;
      if (typeof raw !== 'string') return [];
      try {
        return [urlKey(new URL(raw, url).href)];
      } catch {
        return [];
      }
    });
  };
  const matching = found.filter((node) => identity(node).some((key) => keys.has(key)));
  // When the graph identifies this URL, other article entities are unrelated.
  return matching.length ? matching : found.filter((node) => identity(node).length === 0);
}
