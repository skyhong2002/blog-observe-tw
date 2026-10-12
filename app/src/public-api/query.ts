import { createHash } from 'node:crypto';
import { API_LIMITS } from './contract.ts';
export const badQuery = () => Object.assign(Error('invalid_query'), { statusCode: 400 });
export const badCursor = () => Object.assign(Error('invalid_cursor'), { statusCode: 400 });
export function queryValues(raw: unknown, allowed: string[]): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badQuery();
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.includes(key) || typeof value !== 'string' || value.length > 4096) throw badQuery();
    result[key] = value;
  }
  return result;
}
export function limitValue(value?: string) {
  if (value === undefined) return API_LIMITS.defaultLimit;
  if (!/^[1-9]\d{0,2}$/.test(value) || Number(value) > API_LIMITS.maxLimit) throw badQuery();
  return Number(value);
}
export function searchValue(value?: string) {
  if (value === undefined) return '';
  if (Array.from(value).length > 100 || /[\p{Cc}\p{Cf}]/u.test(value)) throw badQuery();
  return value.trim();
}
export function slugValue(value: string) {
  if (!value || value.length > 180 || /[\p{Cc}\p{Cf}/\\]/u.test(value)) throw badQuery();
  return value;
}
export const escapeLike = (value: string) => value.replace(/[!%_]/g, (v) => `!${v}`);
export function hoursValue(raw?: string) {
  if (raw === undefined) return 720;
  if (!['168', '720', '2160'].includes(raw)) throw badQuery();
  return Number(raw);
}
export const encodeCursor = (payload: object) => Buffer.from(JSON.stringify(payload)).toString('base64url');
function decodeCursor(raw: string): Record<string, unknown> {
  try {
    if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw badCursor();
    const result = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!result || Array.isArray(result) || typeof result !== 'object' || result.v !== 1) throw badCursor();
    return result;
  } catch {
    throw badCursor();
  }
}
const hash = (value: object) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function dateValue(raw: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(raw)) throw badQuery();
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000Z', 'Z') !== raw.replace('.000Z', 'Z')) throw badQuery();
  return date.getTime();
}
export function articleQuery(query: Record<string, string>, scopedBlog?: string, now = Date.now()) {
  const limit = limitValue(query.limit),
    q = searchValue(query.q);
  const blog = scopedBlog ? slugValue(scopedBlog) : query.blog ? slugValue(query.blog) : null;
  if (query.hours !== undefined && (query.since !== undefined || query.until !== undefined)) throw badQuery();
  if ((query.since === undefined) !== (query.until === undefined)) throw badQuery();
  const hours = query.hours === undefined ? 720 : Number(query.hours);
  if (query.hours !== undefined && (!/^[1-9]\d{0,3}$/.test(query.hours) || hours > 2160)) throw badQuery();
  const explicitSince = query.since === undefined ? null : dateValue(query.since);
  const explicitUntil = query.until === undefined ? null : dateValue(query.until);
  const filter = hash({ q, blog, hours: explicitSince === null ? hours : null, since: explicitSince, until: explicitUntil });
  let until = explicitUntil ?? now,
    since = explicitSince ?? until - hours * 3600000;
  let after: { at: number; id: number } | null = null;
  if (query.cursor !== undefined) {
    const c = decodeCursor(query.cursor);
    if (
      c.kind !== 'articles' ||
      c.filter !== filter ||
      !safeId(c.id) ||
      typeof c.at !== 'number' ||
      !Number.isSafeInteger(c.at) ||
      typeof c.since !== 'number' ||
      typeof c.until !== 'number' ||
      !Number.isSafeInteger(c.since) ||
      !Number.isSafeInteger(c.until)
    )
      throw badCursor();
    since = c.since;
    until = c.until;
    after = { at: c.at, id: c.id };
    if (
      (explicitSince !== null && explicitSince !== since) ||
      (explicitUntil !== null && explicitUntil !== until) ||
      c.at < since ||
      c.at > until
    )
      throw badCursor();
  }
  if (since < 0 || until > now + 60000 || until <= since || until - since > 2160 * 3600000 || !Number.isFinite(new Date(until).getTime()))
    throw query.cursor ? badCursor() : badQuery();
  if (explicitSince === null && until - since !== hours * 3600000) throw badCursor();
  return {
    limit,
    q,
    blog,
    since,
    until,
    after,
    next: (at: number, id: number) => encodeCursor({ v: 1, kind: 'articles', filter, since, until, at, id }),
  };
}
export function blogsQuery(query: Record<string, string>) {
  const limit = limitValue(query.limit),
    q = searchValue(query.q),
    filter = hash({ q });
  let after = 0;
  if (query.cursor !== undefined) {
    const c = decodeCursor(query.cursor);
    if (c.kind !== 'blogs' || c.filter !== filter || !safeId(c.id)) throw badCursor();
    after = c.id;
  }
  return { limit, q, after, next: (id: number) => encodeCursor({ v: 1, kind: 'blogs', filter, id }) };
}
