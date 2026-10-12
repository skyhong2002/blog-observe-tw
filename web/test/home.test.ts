import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Blog, Post } from '../src/lib/api.ts';
import { blogIconUrls, latestPostsBySlug, recentBlogRows } from '../src/lib/home.ts';
import { mediaIconSource } from '../src/lib/media-icons.ts';

const blog = (slug: string, extra: Partial<Blog> = {}): Blog => ({ slug, name: slug.toUpperCase(), ...extra });
const post = (blogSlug: string, title: string, publishedAt: string | null, id = 0): Post => ({
  id,
  title,
  url: `https://${blogSlug}.example.com/${id}`,
  publishedAt,
  blogSlug,
});

test('recentBlogs is preferred and keeps the gateway order and latestPost', () => {
  const rows = recentBlogRows({
    blogs: [blog('old', { lastPublishedAt: '2026-10-11T00:00:00Z' })],
    posts: [post('b', 'from sample', '2026-10-12T00:00:00Z', 9)],
    recentBlogs: [
      blog('a', { latestPost: { id: 1, title: 'A1', url: 'https://a.example.com/1', publishedAt: '2026-10-10T00:00:00Z' } }),
      blog('b', { latestPost: null, lastPublishedAt: '2026-10-09T00:00:00Z' }),
    ],
  });
  assert.deepEqual(
    rows.map((row) => [row.blog.slug, row.latest?.title ?? null, row.missing, row.publishedAt]),
    [
      ['a', 'A1', null, '2026-10-10T00:00:00Z'],
      // An explicit null is authoritative: no title is borrowed from the post sample.
      ['b', null, 'none', '2026-10-09T00:00:00Z'],
    ],
  );
});

test('older gateways: blogs sorted by newest time, titles looked up in posts by slug', () => {
  const rows = recentBlogRows(
    {
      blogs: [
        blog('quiet'),
        blog('x', { lastPublishedAt: '2026-10-01T00:00:00Z' }),
        blog('y', { lastPublishedAt: '2026-10-05T00:00:00Z' }),
        blog('z', { lastPublishedAt: 'not a date' }),
      ],
      posts: [
        post('x', 'X old', '2026-09-01T00:00:00Z', 1),
        post('x', 'X new', '2026-10-01T00:00:00Z', 2),
        post('z', 'Z1', '2026-10-03T00:00:00Z', 3),
      ],
    },
    10,
  );
  assert.deepEqual(
    rows.map((row) => [row.blog.slug, row.latest?.title ?? null, row.missing]),
    [
      ['y', null, 'unknown'],
      ['z', 'Z1', null],
      ['x', 'X new', null],
    ],
  );
});

test('limit and duplicate slugs', () => {
  const recentBlogs = ['a', 'b', 'a', 'c'].map((slug) => blog(slug, { latestPost: null }));
  assert.deepEqual(
    recentBlogRows({ blogs: [], posts: [], recentBlogs }, 2).map((row) => row.blog.slug),
    ['a', 'b'],
  );
});

test('latestPostsBySlug prefers dated, newer posts', () => {
  const map = latestPostsBySlug([
    post('a', 'undated', null, 1),
    post('a', 'dated', '2026-01-01T00:00:00Z', 2),
    post('a', 'older', '2025-01-01T00:00:00Z', 3),
  ]);
  assert.equal(map.get('a')?.title, 'dated');
});

test('homepage icon lookup: payload iconUrl by blog slug, recentBlogs first, unknown slugs absent', () => {
  const urls = blogIconUrls({
    recentBlogs: [blog('a', { iconUrl: '/favicons/a.png?v=r2' }), blog('b', { iconUrl: '  ' })],
    blogs: [
      blog('a', { iconUrl: '/favicons/a.png?v=old' }),
      blog('b', { iconUrl: 'https://b.example.com/favicon.ico' }),
      blog('c', { iconUrl: null }),
      blog('', { iconUrl: '/favicons/x.png' }),
    ],
  });
  assert.deepEqual(
    [...urls],
    [
      ['a', '/favicons/a.png?v=r2'],
      ['b', 'https://b.example.com/favicon.ico'],
    ],
  );
  // Server render has no manifest yet: a known slug renders its logo, an unknown one the initial.
  assert.equal(mediaIconSource('a', {}, urls.get('a'), [], 14)?.src, '/images/icons/a/16.webp?v=r2');
  assert.equal(mediaIconSource('c', {}, urls.get('c'), [], 14), null);
  // Another blog's logo is never turned into this slug's local derivative.
  assert.deepEqual(mediaIconSource('z', {}, urls.get('a'), [], 14), { src: '/favicons/a.png?v=r2', local: false });
  assert.equal(blogIconUrls({ blogs: [] }).size, 0);
});
