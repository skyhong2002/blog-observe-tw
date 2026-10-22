import * as cheerio from 'cheerio';
import { TECH_LIMITS } from '../contracts.ts';
import { MATCH_BUDGET_MS, type MatchInput } from './matcher.ts';

export type ResponseHeaders = Headers | Record<string, string | undefined> | undefined;

export function headerTable(headers: ResponseHeaders): Map<string, string[]> {
  const table = new Map<string, string[]>();
  const put = (name: string, value: string | undefined) => {
    if (typeof value !== 'string') return;
    const key = name.toLowerCase();
    table.set(key, [...(table.get(key) ?? []), value.slice(0, 512)]);
  };
  if (headers instanceof Headers) for (const [name, value] of headers.entries()) put(name, value);
  else for (const [name, value] of Object.entries(headers ?? {})) put(name, value);
  return table;
}

/**
 * What the Wappalyzer rules read out of one response: its meta tags, script addresses and inline scripts (at most
 * TECH_LIMITS.nodes of them), the headers, and the parsed document for selector rules.
 */
export function matchInputOf(url: string, html: string, headers?: ResponseHeaders): { input: MatchInput; inspectedNodes: number } {
  const $ = cheerio.load(html);
  const meta = new Map<string, string[]>();
  const scriptSrc: string[] = [];
  const scripts: string[] = [];
  let inspectedNodes = 0;
  $('meta[name],meta[property],script')
    .slice(0, TECH_LIMITS.nodes)
    .each((_index, element) => {
      inspectedNodes++;
      const el = $(element);
      if (element.tagName === 'meta') {
        const name = (el.attr('name') ?? el.attr('property') ?? '').trim().toLowerCase();
        if (name) meta.set(name, [...(meta.get(name) ?? []), (el.attr('content') ?? '').slice(0, 512)]);
        return;
      }
      const src = el.attr('src');
      if (!src) scripts.push(el.html()?.slice(0, 65536) ?? '');
      else if (src.length <= 4096)
        try {
          scriptSrc.push(new URL(src, url).href);
        } catch {
          /* an unusable address proves nothing */
        }
    });
  return {
    input: { url, html, scriptSrc, scripts, meta, headers: headerTable(headers), dom: $, deadline: performance.now() + MATCH_BUDGET_MS },
    inspectedNodes,
  };
}
