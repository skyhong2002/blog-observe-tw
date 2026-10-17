import { type BlogGenre, isBlogGenre } from '../../app/src/blog-genre-vocabulary.ts';

type SeedEntry = {
  slug: string;
  source: 'ai';
  labelledAt: string;
  confidence: 'high' | 'medium' | 'low';
  genres: { genre: BlogGenre; reason: string }[];
};
export function validateGenreSeed(raw: unknown): { version: 2; totalBlogs: number; entries: SeedEntry[] } {
  const seed = raw as { version: number; totalBlogs: number; entries: SeedEntry[] };
  if (seed?.version !== 2 || !Array.isArray(seed.entries) || seed.entries.length !== seed.totalBlogs) throw Error('invalid seed');
  const slugs = new Set<string>();
  for (const entry of seed.entries) {
    if (
      !/^[\w.-]{1,255}$/.test(entry.slug) ||
      slugs.has(entry.slug) ||
      entry.source !== 'ai' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.labelledAt) ||
      !['high', 'medium', 'low'].includes(entry.confidence) ||
      !Array.isArray(entry.genres) ||
      entry.genres.length < 1 ||
      entry.genres.length > 3 ||
      new Set(entry.genres.map((g) => g.genre)).size !== entry.genres.length ||
      entry.genres.some((g) => !isBlogGenre(g.genre) || typeof g.reason !== 'string' || !g.reason.trim())
    )
      throw Error('invalid seed entry');
    slugs.add(entry.slug);
  }
  return seed as { version: 2; totalBlogs: number; entries: SeedEntry[] };
}
