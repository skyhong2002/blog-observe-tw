import { type BlogGenre, isBlogGenre } from '../../app/src/blog-genre-vocabulary.ts';

export type GenreReview = {
  version: 1;
  observedAt: string;
  totalBlogs: number;
  entries: {
    slug: string;
    name: string;
    genres: { genre: BlogGenre; evidence: string[]; matchingLabels?: number; sampledLabels?: number }[];
  }[];
};
type BlogEvidence = { slug: string; name: string; description?: string | null; category: string };
type TagEvidence = { slug: string; labels: string };
const rules: Partial<Record<BlogGenre, { identity: RegExp; tags: RegExp }>> = {
  food: { identity: /美食|食記|吃貨|食旅/, tags: /美食|食記|餐廳|小吃|甜點|咖啡廳|愛食記/ },
  travel: { identity: /旅遊|旅行|自由行/, tags: /旅遊|旅行|自由行|景點|住宿|飯店|一日遊/ },
  gadgets: { identity: /3c|消費電子|科技產品|手機評測/i, tags: /3c|iphone|android|手機|筆電|耳機|智慧手錶|相機|平板/i },
  programming: { identity: /程式|軟體工程|前端|後端|軟體工程師/, tags: /程式|前端|後端|javascript|typescript|python|golang|rust|devops/i },
  life: { identity: /生活內容|生活隨筆|生活日記|生活札記/, tags: /生活隨筆|生活日記|生活札記/ },
  parenting: { identity: /育兒|親子|教養/, tags: /育兒|親子|教養|育嬰|寶寶副食品/ },
  news: { identity: /新聞媒體|新聞網|通訊社/, tags: /新聞媒體|新聞網|通訊社/ },
  finance: { identity: /財經|理財|投資筆記/, tags: /理財|投資|信用卡|保險|股票|基金/ },
};

/** One stray RSS category is not a blog genre. Broad "technology" alone does not mean product reviews. */
export function proposeGenres(blogs: BlogEvidence[], tags: TagEvidence[], observedAt: string): GenreReview {
  const bySlug = new Map(tags.map((row) => [row.slug, [...new Set(row.labels.split('\n').filter(Boolean))]]));
  return {
    version: 1,
    observedAt,
    totalBlogs: blogs.length,
    entries: blogs
      .toSorted((a, b) => a.slug.localeCompare(b.slug, 'en'))
      .flatMap((blog) => {
        const labels = bySlug.get(blog.slug) ?? [];
        const genres = (Object.entries(rules) as [BlogGenre, NonNullable<(typeof rules)[BlogGenre]>][]).flatMap(([genre, rule]) => {
          const identity = [blog.name, blog.description, blog.category].filter((v): v is string => !!v && rule.identity.test(v));
          const matching = labels.filter((label) => rule.tags.test(label));
          if (!identity.length && matching.length < 6 && (matching.length < 3 || matching.length / labels.length < 0.25)) return [];
          return [
            {
              genre,
              matchingLabels: matching.length,
              sampledLabels: labels.length,
              evidence: [...identity.map((v) => `identity: ${v}`), ...matching.slice(0, 5).map((v) => `feed-category: ${v}`)],
            },
          ];
        });
        return genres.length ? [{ slug: blog.slug, name: blog.name, genres }] : [];
      }),
  };
}

/** The deployed map contains only assignments in the review file; removing an entry also removes its assignment. */
export function genreMap(review: GenreReview): Record<string, BlogGenre[]> {
  if (review.version !== 1 || !Number.isSafeInteger(review.totalBlogs) || review.totalBlogs < review.entries.length)
    throw Error('invalid-genre-review');
  const result = new Map<string, BlogGenre[]>();
  for (const entry of review.entries.toSorted((a, b) => a.slug.localeCompare(b.slug, 'en'))) {
    if (!/^[\w.-]{1,255}$/.test(entry.slug) || result.has(entry.slug) || !entry.genres.length) throw Error('invalid-genre-entry');
    for (const assignment of entry.genres) {
      if (
        !isBlogGenre(assignment.genre) ||
        !assignment.evidence.length ||
        assignment.evidence.some((v) => typeof v !== 'string' || !v.trim())
      )
        throw Error('invalid-genre-assignment');
    }
    result.set(entry.slug, [...new Set(entry.genres.map((v) => v.genre))].sort());
  }
  return Object.fromEntries(result);
}
