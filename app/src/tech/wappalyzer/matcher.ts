/**
 * A small matcher for the Wappalyzer technology-rule format (the `src/technologies/*.json` files of the community
 * fork enthec/webappanalyzer). Written from the public rule schema; no code from wappalyzer-core is used, so this
 * file stays MIT. The rule data itself is GPL-3.0 and is never committed: see rules.ts and tools/fetch-wappalyzer-rules.ts.
 *
 * Evaluated: url, html, scriptSrc, scripts, meta, headers, dom (exists / attributes). Not evaluated, because they need a
 * browser, cookies or extra requests: js, css, cookies, xhr, dns, probe, implies, excludes. A dom `text` pattern is also
 * ignored: it matches what a post says, and an article mentioning a product does not mean the site runs it.
 */
import type * as cheerio from 'cheerio';

export type RuleKind = 'url' | 'html' | 'scriptSrc' | 'scripts' | 'meta' | 'headers' | 'dom';
export type RulePattern = {
  /** null: the field only has to exist. */
  regex: RegExp | null;
  version: string;
  confidence: number;
};
export type CompiledRule = {
  kind: RuleKind;
  /** meta / headers name (lower case), or the dom selector. */
  key?: string;
  /** dom only: which attribute the pattern reads; absent means the selector merely has to match. */
  attribute?: string;
  pattern: RulePattern;
};
export type CompiledTech = { name: string; rules: CompiledRule[] };

/** What the matcher reads: values the caller already extracted from one response. */
export type MatchInput = {
  url: string;
  html: string;
  scriptSrc: string[];
  scripts: string[];
  /** lower-case meta name → contents */
  meta: Map<string, string[]>;
  /** lower-case header name → values */
  headers: Map<string, string[]>;
  dom: cheerio.CheerioAPI;
  /** performance.now() after which no further rule is run on this page (see MATCH_BUDGET_MS). */
  deadline?: number;
};
export type MatchResult = {
  /** 0–100, the sum of the matched rules' confidence, capped. */
  confidence: number;
  /** Versions captured from a `meta generator` rule only. */
  generatorVersions: string[];
  matched: RuleKind[];
  generator: boolean;
};

const MAX_PATTERN = 600;
/**
 * The rule data is third-party and the pages are untrusted: a few real rules (`<link rel="stylesheet" [^>]+/wp-…`) take
 * seconds on 512 KiB of repeated `<link ` because the regular-expression engine backtracks quadratically. Long texts are
 * therefore tested in small overlapping windows (a match is a tag or a short phrase, never thousands of characters),
 * which divides that cost by the square of the ratio, and a page gets a fixed time budget on top.
 */
export const MATCH_BUDGET_MS = 250;
const WINDOW = 4096;
const OVERLAP = 1024;
const expired = (deadline: number | undefined) => deadline !== undefined && performance.now() > deadline;

/** Tests a possibly long text; an anchored pattern is only tried where its anchor can hold. */
function testWindowed(pattern: RulePattern, text: string, deadline: number | undefined): boolean {
  const { regex } = pattern;
  if (regex === null) return true;
  if (text.length <= WINDOW) return regex.test(text);
  const start = regex.source.startsWith('^');
  const end = /(?<!\\)\$$/.test(regex.source);
  if (start && end) return false;
  if (start) return regex.test(text.slice(0, WINDOW));
  if (end) return regex.test(text.slice(-WINDOW));
  for (let at = 0; at < text.length; at += WINDOW - OVERLAP) {
    if (expired(deadline)) return false;
    if (regex.test(text.slice(at, at + WINDOW))) return true;
  }
  return false;
}

/** `regex\;version:\1\;confidence:50` → its parts; null when the regex does not compile. */
export function parsePattern(raw: unknown): RulePattern | null {
  if (typeof raw !== 'string') return null;
  const [source, ...attributes] = raw.split('\\;');
  if (source.length > MAX_PATTERN) return null;
  let confidence = 100;
  let version = '';
  for (const attribute of attributes) {
    const at = attribute.indexOf(':');
    if (at < 0) continue;
    const key = attribute.slice(0, at);
    const value = attribute.slice(at + 1);
    if (key === 'confidence') {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0 && number <= 100) confidence = number;
    } else if (key === 'version') version = value;
  }
  if (source === '') return { regex: null, version, confidence };
  try {
    return { regex: new RegExp(source, 'i'), version, confidence };
  } catch {
    return null;
  }
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One technology's rules in the evaluated subset; unknown or unsafe fields are dropped. */
export function compileTech(name: string, raw: unknown): CompiledTech {
  const rules: CompiledRule[] = [];
  if (!isRecord(raw)) return { name, rules };
  const add = (kind: RuleKind, source: unknown, extra: { key?: string; attribute?: string } = {}) => {
    const pattern = parsePattern(source);
    if (pattern) rules.push({ kind, ...extra, pattern });
  };
  for (const kind of ['url', 'html', 'scriptSrc', 'scripts'] as const) for (const source of listOf(raw[kind])) add(kind, source);
  for (const kind of ['meta', 'headers'] as const) {
    const table = raw[kind];
    if (!isRecord(table)) continue;
    for (const [key, value] of Object.entries(table)) for (const source of listOf(value)) add(kind, source, { key: key.toLowerCase() });
  }
  const dom = raw.dom;
  if (typeof dom === 'string' || Array.isArray(dom)) {
    for (const selector of listOf(dom)) if (typeof selector === 'string') add('dom', '', { key: selector });
  } else if (isRecord(dom)) {
    for (const [selector, spec] of Object.entries(dom)) {
      if (!isRecord(spec)) {
        add('dom', '', { key: selector });
        continue;
      }
      if ('exists' in spec) add('dom', typeof spec.exists === 'string' ? spec.exists : '', { key: selector });
      if (isRecord(spec.attributes))
        for (const [attribute, source] of Object.entries(spec.attributes)) add('dom', source, { key: selector, attribute });
    }
  }
  return { name, rules };
}

const matches = (pattern: RulePattern, value: string) => pattern.regex === null || pattern.regex.test(value);

/** Whether one rule matches, plus the versions its capture group yields (meta rules only). */
function matchRule(rule: CompiledRule, input: MatchInput): { hit: boolean; versions?: string[] } {
  const { pattern } = rule;
  switch (rule.kind) {
    case 'url':
      return { hit: matches(pattern, input.url) };
    case 'html':
      return { hit: testWindowed(pattern, input.html, input.deadline) };
    case 'scriptSrc':
      return { hit: input.scriptSrc.some((value) => !expired(input.deadline) && matches(pattern, value)) };
    case 'scripts':
      return { hit: input.scripts.some((value) => !expired(input.deadline) && testWindowed(pattern, value, input.deadline)) };
    case 'headers': {
      const values = input.headers.get(rule.key ?? '') ?? [];
      return { hit: pattern.regex === null ? values.length > 0 : values.some((value) => pattern.regex?.test(value)) };
    }
    case 'meta': {
      const values = input.meta.get(rule.key ?? '') ?? [];
      if (pattern.regex === null) return { hit: values.length > 0 };
      // Every matching tag counts: a page can carry stale or duplicated generators, and the caller decides on conflicts.
      const versions: string[] = [];
      let hit = false;
      for (const value of values) {
        const found = pattern.regex.exec(value);
        if (!found) continue;
        hit = true;
        if (pattern.version === '\\1' && found[1]) versions.push(found[1]);
      }
      return { hit, versions };
    }
    case 'dom': {
      let elements: cheerio.Cheerio<import('domhandler').Element>;
      try {
        elements = input.dom(rule.key ?? '') as cheerio.Cheerio<import('domhandler').Element>;
      } catch {
        return { hit: false };
      }
      if (!elements.length) return { hit: false };
      if (!rule.attribute) return { hit: true };
      const attribute = rule.attribute;
      return {
        hit: elements.toArray().some((element) => {
          const value = input.dom(element).attr(attribute);
          return value !== undefined && matches(pattern, value);
        }),
      };
    }
  }
}

/** Evaluates every rule of one technology. Confidence is the capped sum of matched rules; a total of 0 is no detection. */
export function matchTech(tech: CompiledTech, input: MatchInput): MatchResult | null {
  let confidence = 0;
  let generator = false;
  const generatorVersions: string[] = [];
  const matched = new Set<RuleKind>();
  for (const rule of tech.rules) {
    if (expired(input.deadline)) break;
    const { hit, versions } = matchRule(rule, input);
    if (!hit) continue;
    confidence += rule.pattern.confidence;
    if (rule.pattern.confidence > 0) matched.add(rule.kind);
    if (rule.kind === 'meta' && rule.key === 'generator') {
      generator = true;
      generatorVersions.push(...(versions ?? []));
    }
  }
  if (confidence <= 0) return null;
  return { confidence: Math.min(100, confidence), generatorVersions, matched: [...matched], generator };
}
