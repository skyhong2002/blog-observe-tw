/**
 * The fields public pages need from each public gateway payload, checked on
 * every 200 by the server (public-read.ts) and the browser (public-loader.ts).
 * A 200 whose shape is wrong is a failure, not an empty page or a 404: on the
 * server it throws, so ISR keeps the last good page.
 *
 * Shapes follow the gateway routes (app/src/overview.js, catalog.js,
 * catalog-authors.js, search.ts, topics/routes.ts, relations/routes.ts,
 * v1/similarweb-routes.ts, ai/routes.ts, content/routes.ts and app.js). Only
 * containers and the keys the pages index into are required, never that a
 * list is non-empty: an empty list, a null profile or "unavailable" vocabulary
 * are valid answers. Pure: node --test imports this file.
 */
import { pageInfoOf } from './page-links.ts';
import type { PublicKind } from './public-paths.ts';

type Value = Record<string, unknown>;
const object = (value: unknown): value is Value => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): value is unknown[] => Array.isArray(value);
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown) => typeof value === 'string';
const nullable = (check: (value: unknown) => boolean) => (value: unknown) => value === null || check(value);
const optional = (check: (value: unknown) => boolean) => (value: unknown) => value === undefined || check(value);
/** Every listed key passes its check. */
const shape = (value: unknown, checks: Record<string, (value: unknown) => boolean>): value is Value =>
  object(value) && Object.entries(checks).every(([key, check]) => check(value[key]));
const rows = (value: unknown, checks: Record<string, (value: unknown) => boolean> = {}) =>
  list(value) && value.every((row) => shape(row, checks));

const pagination = (value: unknown) => shape(value, { page: number, pages: number, pageSize: number, total: number });
const topicItems = (value: unknown) => rows(value, { id: text, label: text });
const relationCoverage = (value: unknown) => shape(value, { nonBodyLinks: object });

export const PUBLIC_CONTRACTS: Record<PublicKind, (raw: unknown) => boolean> = {
  overview: (raw) =>
    shape(raw, {
      posts: rows,
      tags: rows,
      authors: rows,
      blogs: rows,
      recentBlogs: optional(rows),
      totals: (value) => shape(value, { blogs: number, posts: number }),
      updatedAt: optional(nullable(text)),
    }),
  catalog: (raw) =>
    shape(raw, {
      blogs: (value) => rows(value, { slug: text, name: text }),
      categories: rows,
      statuses: rows,
      totals: (value) => shape(value, { blogs: number, posts: number, withUrls: number, authors: number }),
      pagination,
      filters: object,
    }),
  authors: (raw) =>
    shape(raw, {
      authors: (value) => rows(value, { displayName: text }),
      totals: object,
      matchedAuthors: number,
      pagination,
      filters: (value) => shape(value, { author: nullable(number) }),
    }),
  search: (raw) => shape(raw, { items: list }),
  topics: (raw) => shape(raw, { items: topicItems, vocabulary: object }),
  topic: (raw) =>
    shape(raw, {
      topic: (value) => shape(value, { id: text, label: text }),
      blogs: rows,
      articles: rows,
      vocabulary: object,
    }),
  relations: (raw) =>
    shape(raw, { nodes: rows, edges: rows, mostMentioned: rows, mutual: rows, coverage: relationCoverage, generatedAt: text }),
  traffic: (raw) => shape(raw, { blogs: list }),
  tag: (raw) => shape(raw, { tag: (value) => shape(value, { slug: text, label: text }), posts: rows, blogs: rows }),
  blog: (raw) =>
    shape(raw, {
      blog: (value) => shape(value, { slug: text, name: text, authors: optional(rows), tags: optional(rows) }),
      posts: rows,
    }),
  blogRelations: (raw) => shape(raw, { nodes: rows, outgoing: rows, incoming: rows, evidence: optional(rows), coverage: object }),
  blogTopics: (raw) => shape(raw, { items: topicItems, vocabulary: object }),
  blogInference: (raw) =>
    shape(raw, {
      label: text,
      overridden: (value) => typeof value === 'boolean',
      profile: nullable(object),
      provenance: nullable(object),
      topics: rows,
    }),
  blogContent: (raw) => shape(raw, { blog: object, sources: rows }),
  // Every field: the page's canonical, robots and the stable id of its API reads come from here.
  blogPage: (raw) => pageInfoOf('blog', raw) !== null,
  topicPage: (raw) => pageInfoOf('topic', raw) !== null,
};

/** True when a 200 payload has what the page for this kind of path reads. */
export const validPublicPayload = (kind: PublicKind, raw: unknown) => PUBLIC_CONTRACTS[kind](raw);
