import type { Pool } from 'mysql2/promise';
export const CONTENT_VERSION = 'blog-content-v2';
export const MAX_CONTENT_HTML_BYTES = 256 * 1024;
export const MAX_CONTENT_TEXT_BYTES = 128 * 1024;
export type ContentKind = 'rss-content' | 'atom-content' | 'wordpress-api' | 'article-html';
export type Completeness = 'full' | 'partial' | 'unknown';
export type ContentSql = Pick<Pool, 'execute'>;
export type ContentEvidence = {
  blogId: number;
  blogUrl: string;
  articleUrl: string;
  sourceUrl: string;
  html: string;
  kind: ContentKind;
  truncated?: boolean;
  completeness?: Completeness;
  obtainedAt?: Date;
  modifiedAt?: Date | null;
  postId?: number;
  etag?: string | null;
  lastModified?: string | null;
};
export type ContentRules = { bodySelector?: string; bodyExcludeSelector?: string; apiBase?: string };
export type ContentRule = {
  blogId: number;
  platform: string;
  adapterId: string;
  version: string;
  rules: ContentRules;
  revision: number;
  source: 'inferred' | 'manual';
};
export type ExtractedContent = {
  bodyText: string;
  bodyHtml: string;
  hash: string;
  platform: string;
  adapterId: string;
  completeness: Completeness;
  status: 'ok' | 'partial' | 'missing' | 'blocked';
  reason: string | null;
  imageOnly: boolean;
  truncated: boolean;
  sourceKind: ContentKind;
  coverage: 'html-page' | 'syndicated-body-only';
};
export function utf8Prefix(value: string, bytes: number): string {
  if (Buffer.byteLength(value) <= bytes) return value;
  const buffer = Buffer.from(value);
  let end = bytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString('utf8');
}
