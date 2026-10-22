import * as cheerio from 'cheerio';
import { TECH_LIMITS } from './contracts.ts';
import { matchInputOf, type ResponseHeaders } from './wappalyzer/input.ts';
import { matchTech } from './wappalyzer/matcher.ts';
import { activeWappalyzerRules } from './wappalyzer/rules.ts';

/** The blogging platforms the content adapters know (content/registry.ts ADAPTER_SELECTORS). */
export const DOCUMENT_PLATFORMS = ['wordpress', 'blogger', 'hugo', 'jekyll', 'ghost', 'hexo'] as const;
export type DocumentPlatform = (typeof DOCUMENT_PLATFORMS)[number];

const GENERATOR = /^(WordPress|Blogger|Hugo|Jekyll|Ghost|Hexo)\b/i;

/** Without the Wappalyzer rules: an explicit generator tag, else a stylesheet/script of WordPress itself. Head signals only. */
function builtInPlatform(html: string): DocumentPlatform | null {
  const $ = cheerio.load(html);
  const declared = new Set<string>();
  $('meta[name="generator" i]')
    .slice(0, 20)
    .each((_index, element) => {
      const found = GENERATOR.exec($(element).attr('content')?.trim() ?? '');
      if (found) declared.add(found[1].toLowerCase());
    });
  if (declared.size === 1) return [...declared][0] as DocumentPlatform;
  if (declared.size > 1) return null;
  const asset = $('link[rel~="stylesheet" i][href],script[src]')
    .slice(0, TECH_LIMITS.nodes)
    .toArray()
    .some((element) => /\/wp-(?:content|includes)\//.test($(element).attr('href') ?? $(element).attr('src') ?? ''));
  return asset ? 'wordpress' : null;
}

/**
 * Which blogging platform a page's own document says it runs, or null when it does not say. Only a whole page of the
 * blog may be passed: never the text of a post or a feed's content, where an image from another site's wp-content, or
 * a quoted block of markup, would say nothing about the blog. Uses the pinned Wappalyzer rules when installed; when two
 * platforms tie, an explicit generator tag decides and otherwise nothing does.
 */
export function documentPlatform(url: string, html: string, headers?: ResponseHeaders): DocumentPlatform | null {
  const bounded = html.slice(0, TECH_LIMITS.htmlBytes);
  const rules = activeWappalyzerRules();
  if (!rules) return builtInPlatform(bounded);
  const { input } = matchInputOf(url, bounded, headers);
  const scored: { platform: DocumentPlatform; confidence: number; generator: boolean }[] = [];
  for (const platform of DOCUMENT_PLATFORMS) {
    let confidence = 0;
    let generator = false;
    for (const entry of rules.products.get(platform) ?? []) {
      const result = matchTech(entry, input);
      if (!result) continue;
      confidence = Math.max(confidence, result.confidence);
      generator ||= result.generator;
    }
    if (confidence > 0) scored.push({ platform, confidence, generator });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.confidence - a.confidence || Number(b.generator) - Number(a.generator));
  const [first, second] = scored;
  if (second && second.confidence === first.confidence && second.generator === first.generator) return null;
  return first.platform;
}
