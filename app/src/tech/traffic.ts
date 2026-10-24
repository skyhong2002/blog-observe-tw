import { readTagSimilarwebToken } from '../crawl/similarweb-client.ts';
import type { TechDetection } from './contracts.ts';

export type TrafficSite = {
  status: 'detected' | 'unknown' | 'failed' | 'blocked';
  observedAt: string | null;
  lastAttemptAt: string;
  sourceUrl: string | null;
  errorCode: string | null;
  detections: TechDetection[];
};
const categories = [
  'cms',
  'framework',
  'library',
  'server',
  'cdn',
  'hosting',
  'analytics',
  'ads',
  'consent',
  'media',
  'social',
  'security',
  'other',
  'theme',
  'plugin',
];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function parseTrafficSites(value: unknown): Record<string, TrafficSite> {
  if (!object(value) || !object(value.sites) || !Array.isArray(value.notChecked)) throw Error('technology_shape');
  const out: Record<string, TrafficSite> = {};
  for (const [domain, site] of Object.entries(value.sites)) {
    if (
      !object(site) ||
      !['detected', 'unknown', 'failed', 'blocked'].includes(String(site.status)) ||
      !date(site.lastAttemptAt) ||
      !(site.observedAt === null || date(site.observedAt)) ||
      !(site.sourceUrl === null || typeof site.sourceUrl === 'string') ||
      !(
        site.errorCode === null ||
        ['robots', 'waf', 'rate-limit', 'http-error', 'not-html', 'timeout', 'network', 'address'].includes(String(site.errorCode))
      ) ||
      !Array.isArray(site.detections)
    )
      throw Error('technology_shape');
    const detections = site.detections.map((d): TechDetection => {
      if (
        !object(d) ||
        !['id', 'name', 'version', 'ruleId', 'ruleVersion'].every((key) => typeof d[key] === 'string') ||
        !categories.includes(String(d.category)) ||
        typeof d.confidence !== 'number' ||
        !Number.isFinite(d.confidence) ||
        d.confidence < 0 ||
        d.confidence > 1 ||
        !date(d.observedAt) ||
        !Array.isArray(d.evidence)
      )
        throw Error('technology_shape');
      const evidence = d.evidence.map((e) => {
        if (!object(e) || !['generator', 'asset', 'marker', 'header'].includes(String(e.kind)) || typeof e.value !== 'string')
          throw Error('technology_shape');
        return { kind: e.kind as TechDetection['evidence'][number]['kind'], value: e.value };
      });
      return {
        id: String(d.id),
        name: String(d.name),
        category: d.category as TechDetection['category'],
        confidence: d.confidence,
        version: String(d.version),
        ruleId: String(d.ruleId),
        ruleVersion: String(d.ruleVersion),
        observedAt: String(d.observedAt),
        evidence,
      };
    });
    if (
      (site.observedAt === null && detections.length) ||
      (site.status === 'detected' && (!site.observedAt || !detections.length)) ||
      (site.status === 'unknown' && (!site.observedAt || detections.length))
    )
      throw Error('technology_shape');
    out[domain] = {
      status: site.status as TrafficSite['status'],
      observedAt: site.observedAt as string | null,
      lastAttemptAt: String(site.lastAttemptAt),
      sourceUrl: site.sourceUrl as string | null,
      errorCode: site.errorCode as string | null,
      detections,
    };
  }
  return out;
}
export function projectTrafficSite(site?: TrafficSite) {
  return {
    status: site?.status ?? 'not-observed',
    observedAt: site?.observedAt ?? null,
    lastAttemptAt: site?.lastAttemptAt ?? null,
    errorCode: site?.errorCode ?? null,
    evidenceSourceUrl: site?.sourceUrl ?? null,
    coverage: site?.observedAt ? { partial: true, method: 'traffic-homepage-wappalyzer', sourceType: 'html' } : null,
    detections: site?.detections ?? [],
  };
}
/** Same loopback endpoint, credential loader and refusal handling as blog-genres/traffic.ts. Only successes cache. */
export function trafficTechClient({ fetcher = fetch, readToken = () => readTagSimilarwebToken(), now = Date.now } = {}) {
  let cached: { key: string; expires: number; sites: Record<string, TrafficSite> } | undefined;
  let pending: { key: string; promise: Promise<Record<string, TrafficSite>> } | undefined;
  return {
    async read(domains: string[]) {
      const unique = [...new Set(domains)].sort();
      if (unique.length > 2000) throw Error('technology_bound');
      const key = JSON.stringify(unique);
      if (cached?.key === key && cached.expires > now()) return cached.sites;
      if (pending?.key === key) return pending.promise;
      const promise = (async () => {
        const token = await readToken();
        if (!token) throw Error('technology_token');
        const response = await fetcher('http://127.0.0.1:18150/internal/v1/tech', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
          body: key === '[]' ? '{"domains":[]}' : JSON.stringify({ domains: unique }),
          redirect: 'error',
          signal: AbortSignal.timeout(2000),
        });
        if (response.status !== 200) throw Error('technology_service');
        const body = await response.text();
        if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw Error('technology_body');
        const sites = parseTrafficSites(JSON.parse(body));
        cached = { key, expires: now() + 60_000, sites };
        return sites;
      })();
      pending = { key, promise };
      try {
        return await promise;
      } finally {
        if (pending?.promise === promise) pending = undefined;
      }
    },
  };
}
