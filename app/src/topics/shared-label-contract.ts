// Offline F1 contract adapter. No fetch, tokens, routes, sync or fallback data.
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const SHARED_LABEL_CONTRACT = {
  apiVersion: '1',
  sourceSHA: 'b8d030c747f87c997800371e33e1ab2d168ad257',
  consumerCache: 'no-store',
  credentialedCache: 'private, no-store',
  missing: ['payload revision/asOf', 'live deployment verification'],
} as const;
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid shared label contract');
  return v as Record<string, unknown>;
};
// Upstream schema field widths are code points; transport/body budgets are local safeguards.
export const SHARED_LABEL_INPUT_BYTES = 2 * 1024 * 1024;
function boundedJson(raw: unknown) {
  let bytes = 0,
    nodes = 0;
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 50000 || depth > 16) throw Error('Invalid shared label contract');
    if (typeof value === 'string') {
      if (value.length > SHARED_LABEL_INPUT_BYTES) throw Error('Invalid shared label contract');
      bytes += Buffer.byteLength(JSON.stringify(value));
    } else if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) bytes += 24;
    else if (typeof value === 'object' && value && !types.isProxy(value)) {
      if (seen.has(value) || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))))
        throw Error('Invalid shared label contract');
      seen.add(value);
      bytes += 2;
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (Array.isArray(value) && key === 'length') continue;
        if (!descriptor.enumerable || !('value' in descriptor)) throw Error('Invalid shared label contract');
        visit(key, depth + 1);
        bytes += 2;
        visit(descriptor.value, depth + 1);
        if (bytes > SHARED_LABEL_INPUT_BYTES) throw Error('Invalid shared label contract');
      }
      if (Object.getOwnPropertySymbols(value).length) throw Error('Invalid shared label contract');
      seen.delete(value);
    } else throw Error('Invalid shared label contract');
    if (bytes > SHARED_LABEL_INPUT_BYTES) throw Error('Invalid shared label contract');
  };
  visit(raw, 0);
}
const text = (v: unknown, limit = 512): string => {
  if (
    typeof v !== 'string' ||
    v.length > limit * 2 ||
    [...v].length > limit ||
    Buffer.byteLength(v) > limit * 4 ||
    /[\p{Cc}\p{Cs}]/u.test(v)
  )
    throw Error('Invalid shared label contract');
  return v;
};
const nullableText = (v: unknown, limit = 512) => (v === null ? null : text(v, limit));
const bool = (v: unknown) => {
  if (typeof v !== 'boolean') throw Error('Invalid shared label contract');
  return v;
};
const tagHash = (tag: string) => createHash('sha256').update(tag, 'utf8').digest('hex');
function checkedTag(v: unknown, expected: string) {
  const tag = text(v, 60);
  if (tag !== expected || !tag || tag !== tag.trim() || [...tag].length > 60) throw Error('Invalid shared label contract');
  return tag;
}
function href(v: unknown, pattern: RegExp) {
  const path = text(v, 1024);
  if (!pattern.test(path)) throw Error('Invalid shared label contract');
  const url = new URL(path, 'https://tag.observe.tw');
  if (url.origin !== 'https://tag.observe.tw' || url.hash || url.pathname !== path.split('?')[0])
    throw Error('Invalid shared label contract');
  return path;
}
export function parseSharedLabelRelations(raw: unknown, expectedTag: string) {
  boundedJson(raw);
  const data = object(raw),
    tag = checkedTag(data.tag, expectedTag);
  if (data.tagId !== tagHash(tag) || !Array.isArray(data.relations) || data.relations.length > 5000)
    throw Error('Invalid shared label contract');
  return {
    tag,
    tagId: tagHash(tag),
    truncated: bool(data.truncated),
    relations: data.relations.map((entry: unknown) => {
      const r = object(entry),
        target = object(r.target);
      if (
        !['is-a', 'related', 'alias'].includes(String(r.type)) ||
        !['manual', 'rule', 'submission'].includes(String(r.source)) ||
        r.status !== 'approved' ||
        !Number.isSafeInteger(r.depth) ||
        Number(r.depth) < 1
      )
        throw Error('Invalid shared label contract');
      const createdAt = nullableText(r.createdAt, 32);
      if (createdAt !== null && !Number.isFinite(Date.parse(createdAt))) throw Error('Invalid shared label contract');
      const targetId = text(target.id, 64),
        label = text(target.label, targetId.startsWith('group:') ? 32 : 60);
      if (!(targetId === tagHash(label) || /^group:[1-9]\d*$/.test(targetId))) throw Error('Invalid shared label contract');
      const targetHref = href(target.href, /^\/(?:tag\/[^/?#]+|group\/[1-9]\d*)\/$/);
      if (targetHref !== (targetId.startsWith('group:') ? `/group/${targetId.slice(6)}/` : `/tag/${encodeURIComponent(label)}/`))
        throw Error('Invalid shared label contract');
      return {
        id: text(r.id, 128),
        type: text(r.type),
        target: { id: targetId, label, href: targetHref },
        source: text(r.source),
        sourceDetail: text(r.sourceDetail, 16),
        createdAt,
        status: 'approved' as const,
        inherited: bool(r.inherited),
        depth: Number(r.depth),
      };
    }),
  };
}
export function parseSharedLabelVisual(raw: unknown, expectedTag: string) {
  boundedJson(raw);
  const data = object(raw),
    tag = checkedTag(data.tag, expectedTag);
  if (data.visual === null) return { tag, visual: null };
  const v = object(data.visual);
  if (!['place', 'flag', 'logo', 'emoji'].includes(String(v.kind))) throw Error('Invalid shared label contract');
  const imagePath = (value: unknown) => {
    if (value === null) return null;
    const path = text(value, 1024),
      u = new URL(path, 'https://tag.observe.tw');
    if (
      !path.startsWith(`/api/v1/tags/${encodeURIComponent(tag)}/visual-image?`) ||
      u.origin !== 'https://tag.observe.tw' ||
      u.pathname !== `/api/v1/tags/${encodeURIComponent(tag)}/visual-image` ||
      u.hash ||
      !/^[a-z0-9]+$/.test(u.searchParams.get('v') ?? '') ||
      [...u.searchParams.keys()].some((k) => !['v', 'size', 'accent'].includes(k)) ||
      (u.searchParams.has('size') && u.searchParams.get('size') !== 'large') ||
      (u.searchParams.has('accent') && !/^[0-9a-f]{6}$/i.test(u.searchParams.get('accent') ?? ''))
    )
      throw Error('Invalid shared label contract');
    return path;
  };
  const source = v.source === null ? null : object(v.source);
  const publicUrl = (value: unknown, limit = 512) => {
    const s = text(value, limit),
      u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) throw Error('Invalid shared label contract');
    return s;
  };
  return {
    tag,
    visual: {
      kind: text(v.kind),
      emoji: nullableText(v.emoji, 64),
      label: nullableText(v.label, 120),
      wikidataId: nullableText(v.wikidataId, 16),
      image: imagePath(v.image),
      large: imagePath(v.large),
      source: source
        ? {
            pageUrl: publicUrl(source.pageUrl),
            license: nullableText(source.license, 64),
            licenseUrl: source.licenseUrl === null ? null : publicUrl(source.licenseUrl, 255),
            artist: nullableText(source.artist, 255),
          }
        : null,
    },
  };
}
/** Optional enrichment failure leaves the public page alone; missing is never an empty approved result. */
export function optionalSharedLabel<T>(parse: () => T): { status: 'ready'; data: T } | { status: 'missing' } {
  try {
    return { status: 'ready', data: parse() };
  } catch {
    return { status: 'missing' };
  }
}
