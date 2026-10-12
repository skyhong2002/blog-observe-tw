import { describe, expect, it } from 'vitest';
import { articleQuery, blogsQuery, encodeCursor, escapeLike, hoursValue, queryValues } from './query.ts';

const now = Date.parse('2026-10-12T12:00:00Z');
describe('public API query and stable cursor contracts', () => {
  it('anchors later pages and permits limit changes without shifting the window', () => {
    const first = articleQuery({ hours: '168', q: '文字', blog: 'site' }, undefined, now);
    const cursor = first.next(now - 1000, 12);
    const next = articleQuery({ hours: '168', q: '文字', blog: 'site', cursor, limit: '1' }, undefined, now + 3600000);
    expect(next.until).toBe(now);
    expect(next.since).toBe(first.since);
    expect(next.after).toEqual({ at: now - 1000, id: 12 });
    expect(next.limit).toBe(1);
    expect(() => articleQuery({ hours: '168', q: '其他', blog: 'site', cursor }, undefined, now)).toThrow('invalid_cursor');
    expect(() => articleQuery({ hours: '168', q: '文字', blog: 'different', cursor }, undefined, now)).toThrow('invalid_cursor');
    expect(() => articleQuery({ q: '文字', blog: 'site', cursor }, undefined, now)).toThrow('invalid_cursor');
  });
  it('validates ranges, calendar dates and bounded cursors instead of trusting JSON', () => {
    for (const q of [
      { hours: '0' },
      { hours: '2161' },
      { since: '2026-10-01T00:00:00Z' },
      { since: '2026-02-30T00:00:00Z', until: '2026-03-01T00:00:00Z' },
      { hours: '1', since: '2026-10-01T00:00:00Z', until: '2026-10-02T00:00:00Z' },
      { since: '2026-01-01T00:00:00Z', until: '2026-10-01T00:00:00Z' },
      { until: '2027-01-01T00:00:00Z', since: '2026-12-01T00:00:00Z' },
    ])
      expect(() => articleQuery(q as Record<string, string>, undefined, now)).toThrow('invalid_query');
    const first = articleQuery({}, undefined, now),
      decoded = JSON.parse(Buffer.from(first.next(now, 1), 'base64url').toString());
    for (const update of [{ id: -1 }, { at: now + 1 }, { until: now + 3600000 }, { since: 0 }, { kind: 'blogs' }, { v: 2 }])
      expect(() => articleQuery({ cursor: encodeCursor({ ...decoded, ...update }) }, undefined, now)).toThrow('invalid_cursor');
    for (const cursor of ['!', 'e30', 'null', 'a'.repeat(2049)])
      expect(() => articleQuery({ cursor }, undefined, now)).toThrow('invalid_cursor');
  });
  it('requires exact allowed string query names and bounded title search', () => {
    for (const raw of [{ limit: ['1', '2'] }, { foo: '1' }, { limit: 1 }, { q: 'a'.repeat(4097) }])
      expect(() => queryValues(raw, ['limit', 'q'])).toThrow('invalid_query');
    for (const limit of ['0', '201', '2.5', '+2', '01']) expect(() => articleQuery({ limit }, undefined, now)).toThrow('invalid_query');
    expect(() => articleQuery({ q: '😀'.repeat(101) }, undefined, now)).toThrow('invalid_query');
    expect(() => articleQuery({ q: 'a\nb' }, undefined, now)).toThrow('invalid_query');
    expect(escapeLike('50%_!')).toBe('50!%!_!!');
    expect(() => hoursValue('24')).toThrow('invalid_query');
  });
  it('uses independent directory cursor scope and stable ascending identity', () => {
    const first = blogsQuery({ q: 'Blog' }),
      cursor = first.next(123);
    expect(blogsQuery({ q: 'Blog', cursor }).after).toBe(123);
    expect(() => blogsQuery({ q: 'other', cursor })).toThrow('invalid_cursor');
    expect(() => articleQuery({ cursor }, undefined, now)).toThrow('invalid_cursor');
  });
});
