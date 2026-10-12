import ArticleThumbnail from '@/components/ArticleThumbnail';
import BlogIcon from '@/components/BlogIcon';
import Link from '@/components/NoPrefetchLink';
import SourceLink from '@/components/SourceLink';
import { type Post, plainText, taipei } from '@/lib/api';
import { blogLink } from '@/lib/page-links';

/** Markup copied from tag.observe.tw ArticleListItem, commit afe0a65.
 * Blog data keeps source links and tags; news-only discovery/attribution is omitted. */
export default function ArticleListItem({
  post,
  snippet,
  matchSource,
}: {
  post: Post;
  /** Search hit context from /api/search, already plain text and ≤240 characters. */
  snippet?: string | null;
  /** Where the search matched; shown as a small label beside the snippet. */
  matchSource?: 'body' | 'metadata' | null;
}) {
  const article = {
    ...post,
    url: post.url ?? null,
    image: post.imageUrl ?? null,
    description: plainText(post.summary),
    tags: post.tags ?? [],
    authors: post.author ? [post.author] : [],
    media: post.blogSlug,
    mediaTitle: post.blogName,
  };
  const href = article.url;
  const showMedia = Boolean(article.media);
  const match = /^\[([^\]]{1,20})\]\s*([\s\S]+)$/.exec(article.title);
  const headline = match ? { section: match[1], title: match[2] } : { section: null, title: article.title || '未提供標題' };
  const title = (
    <>
      {headline.section && <span className="mr-1.5 text-xs font-normal text-brand-700 dark:text-brand-400">{headline.section}</span>}
      {headline.title}
    </>
  );
  return (
    <li id={article.id ? `article-${article.id}` : undefined} className="scroll-mt-32 py-2.5">
      <article className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-medium leading-6">
            {href ? (
              <Link href={href} className="hover:text-brand-700 dark:hover:text-brand-400">
                {title}
              </Link>
            ) : (
              title
            )}
          </h3>
          {(snippet || matchSource) && (
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
              {matchSource && (
                <span className="mr-1.5 rounded bg-brand-50 px-1 text-[10px] text-brand-800 dark:bg-brand-950 dark:text-brand-300">
                  {matchSource === 'body' ? '內文相符' : '標題或摘要相符'}
                </span>
              )}
              {snippet}
            </p>
          )}
          {!snippet && article.description && (
            <p className="mt-1 hidden text-xs leading-5 text-zinc-500 group-data-[summaries=true]/list:line-clamp-2 dark:text-zinc-400">
              {article.description}
            </p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
            {showMedia && article.media && (
              <Link
                {...blogLink(article.media, post.blogCanonicalPath)}
                className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-400"
              >
                <BlogIcon media={article.media} title={article.mediaTitle} />
                {article.mediaTitle}
              </Link>
            )}
            {article.publishedAt ? <time dateTime={article.publishedAt}>{taipei(article.publishedAt)}</time> : <span>發文日期不明</span>}
            {article.authors.length > 0 && <span className="max-w-40 truncate">{article.authors.join('、')}</span>}
            <SourceLink url={article.url} showUrl className="!min-h-5 !text-[11px]" />
          </div>
          {article.tags.length > 0 && (
            <ul aria-label="關鍵字" className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] leading-5">
              {article.tags.slice(0, 6).map((tag) => (
                <li key={tag.slug}>
                  <Link
                    href={`/tags/?tag=${encodeURIComponent(tag.slug)}`}
                    className="text-zinc-500 hover:text-brand-700 hover:underline dark:text-zinc-400 dark:hover:text-brand-400"
                  >
                    #{tag.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {href && <ArticleThumbnail src={article.image} href={href} title={headline.title} />}
      </article>
    </li>
  );
}
