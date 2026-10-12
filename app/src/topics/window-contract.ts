export { SOURCE } from './snapshot-client.ts';
export interface Window {
  since: string;
  until: string;
}
export interface SourceArticle {
  id: string;
  media: string;
  publishedAt: string;
  tags: string[];
  rawTags?: string[];
  tagNormalization?: string;
  invalidTagCount?: number;
  normalizedTagCount?: number;
  invalidTagSamples?: import('./tag-normalization.ts').InvalidTagEvidence[];
}
export interface ArticlePage {
  articles: SourceArticle[];
  nextCursor: string | null;
}
export interface ArticleSource {
  page(window: Window, cursor: string | null): Promise<ArticlePage>;
}
export function validateWindow(window: Window): void {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  const duration = Date.parse(window.until) - Date.parse(window.since);
  if (!iso.test(window.since) || !iso.test(window.until) || !Number.isFinite(duration) || duration <= 0 || duration > 31 * 86400000)
    throw Error('Tag article window must be explicit timezone ISO and between 0 and 31 days');
}
