// Layout and CSS copied from tag.observe.tw homepage at afe0a65; blog data replaces news-specific measures.

import { Suspense } from 'react';
import BlogIcon from '@/components/BlogIcon';
import Link from '@/components/NoPrefetchLink';
import { displayTitle, plainText, taipei } from '@/lib/api';
import { recentBlogRows } from '@/lib/home';
import { externalHref } from '@/lib/images';
import { blogHref, blogLink } from '@/lib/page-links';
import { homeOverview } from '@/lib/public-api';
import { serializeJsonLd, siteSchema, staticPageMetadata } from '@/lib/seo';
import HomeTopicRanking, { HomeTopicsPending } from './_home/HomeTopics';
import styles from './_home/home.module.css';
import MastheadCloud from './_home/MastheadCloud';
import NewsImage from './_home/NewsImage';
// Rendered per request with no-store reads (public-read.ts): no stored page can
// keep showing an article the gateway has since hidden. A failed read throws.
// Only the bounded overview is awaited here; the topic ranking streams in its own
// Suspense (HomeTopics.tsx) and its failure throws to the same error boundary.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/');
export default async function HomePage() {
  const data = await homeOverview();
  const [lead, ...rest] = data.posts;
  const recentBlogs = recentBlogRows(data, 10);
  const postHref = (post: { url?: string | null; blogSlug?: string; blogCanonicalPath?: string }) =>
    externalHref(post.url) ?? blogHref(post.blogSlug ?? '', post.blogCanonicalPath);
  // Only a real source URL is an original article; the /blogs/ fallback is not.
  const original = (post: { url?: string | null }) => (externalHref(post.url) ? 'open_original' : undefined);
  const updated = data.updatedAt ? `${taipei(data.updatedAt)} 更新` : '等待資料更新';
  return (
    <>
      {/* Static site facts; serializeJsonLd escapes '<'. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteSchema()) }} />
      <div className={styles.home}>
        <MastheadCloud edition={updated} tags={data.tags} />
        <div className={styles.columns}>
          <aside className={styles.left} aria-label="標籤排行與作者">
            <div className={styles.sectionHeading}>
              <h2>最近共同話題</h2>
              <Link href="/topics/">完整排行 →</Link>
            </div>
            <Suspense fallback={<HomeTopicsPending />}>
              <HomeTopicRanking />
            </Suspense>
            <p className={styles.muted}>近 30 天；同站貢獻逐次遞減，至少兩站參與。RSS 標籤與共同詞彙分開列出。</p>
            <div className={`${styles.sectionHeading} ${styles.sectionHeadingLater}`}>
              <h2>作者動態</h2>
              <Link href="/authors/">全部作者 →</Link>
            </div>
            <ol className={styles.journalists}>
              {data.authors.slice(0, 8).map((author) => (
                <li key={`${author.id}-${author.blogSlug}`}>
                  <Link href={`/authors/?author=${author.id}`}>
                    <span className={`${styles.journalistName} inline-flex items-center gap-1.5`}>
                      {author.blogSlug && <BlogIcon media={author.blogSlug} title={author.blogName} />}
                      {author.displayName}
                    </span>
                    <span className={styles.journalistCount}>{author.postCount ?? 0} 篇</span>
                  </Link>
                </li>
              ))}
            </ol>
            {!data.authors.length && <p className={styles.notice}>作者資料整理中。</p>}
          </aside>
          <section className={styles.center} aria-label="最新文章">
            <div className={styles.sectionHeading}>
              <h2>最新文章</h2>
              <Link href="/articles/">全部文章 →</Link>
            </div>
            {lead ? (
              <>
                <article className={styles.hero}>
                  <NewsImage
                    src={lead.imageUrl}
                    href={postHref(lead)}
                    analytics={original(lead)}
                    title={displayTitle(lead.title)}
                    variant="hero"
                  />
                  <div className={styles.heroContent}>
                    <span className={styles.heroBadge}>最近發文</span>
                    <h3>
                      <a href={postHref(lead)} data-analytics={original(lead)} className={styles.heroLink} rel="noopener noreferrer">
                        {displayTitle(lead.title)}
                      </a>
                    </h3>
                    <p className={styles.source}>
                      <Link {...blogLink(lead.blogSlug ?? '', lead.blogCanonicalPath)} className="inline-flex items-center gap-1.5">
                        {lead.blogSlug && <BlogIcon media={lead.blogSlug} title={lead.blogName} />}
                        {lead.blogName}
                      </Link>
                      <span>· {taipei(lead.publishedAt)}</span>
                    </p>
                    <p className="line-clamp-5 text-sm leading-7 text-zinc-600 dark:text-zinc-400">{plainText(lead.summary)}</p>
                    <div className={styles.heroFoot}>
                      <span>{lead.author}</span>
                      <a href={postHref(lead)} data-analytics={original(lead)} rel="noopener noreferrer">
                        到原站閱讀 →
                      </a>
                    </div>
                  </div>
                </article>
                <div className={styles.legend}>
                  <span>各站公開文章，保留作者自己的聲音。</span>
                  <a href="/about/">資料來源與收錄方式 ⓘ</a>
                </div>
                <div className={styles.storyList}>
                  {rest.slice(0, 6).map((post, i) => (
                    <article key={post.id ?? post.url} className={styles.story}>
                      <div className={styles.storyBody}>
                        <p className={styles.storyTags}>
                          <span className={styles.storyIndex}>{String(i + 2).padStart(2, '0')}</span> {post.blogName}
                        </p>
                        <h3>
                          <a href={postHref(post)} data-analytics={original(post)} rel="noopener noreferrer">
                            {displayTitle(post.title)}
                          </a>
                        </h3>
                        <p className={styles.source}>
                          <Link {...blogLink(post.blogSlug ?? '', post.blogCanonicalPath)} className="inline-flex items-center gap-1.5">
                            {post.blogSlug && <BlogIcon media={post.blogSlug} title={post.blogName} />}
                            {post.blogName}
                          </Link>
                          <span>· {taipei(post.publishedAt)}</span>
                        </p>
                      </div>
                      <NewsImage
                        src={post.imageUrl}
                        href={postHref(post)}
                        analytics={original(post)}
                        title={displayTitle(post.title)}
                        variant="thumbnail"
                      />
                    </article>
                  ))}
                  <Link href="/articles/" className={styles.more}>
                    探索更多文章 <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </>
            ) : (
              <div className={styles.empty}>
                <span aria-hidden="true">◎</span>
                <h2>文章整理中</h2>
                <p>文章收錄完成後，會在這裡顯示。</p>
                <Link href="/blogs/">前往部落格目錄 →</Link>
              </div>
            )}
          </section>
          <aside className={styles.right} aria-label="部落格收錄概況">
            <div className={styles.sectionHeading}>
              <h2>部落格觀察</h2>
              <Link href="/blogs/">完整目錄 →</Link>
            </div>
            <div className={styles.brief}>
              <div className={styles.briefCount}>
                {data.totals.blogs}
                <span>個部落格</span>
              </div>
              <p className={styles.briefSub}>已收錄 {data.totals.posts} 篇文章，逐步核對來源與訂閱資訊。</p>
              <Link href="/blogs/" className={styles.textLink}>
                探索部落格 <span>→</span>
              </Link>
            </div>
            <div className={`${styles.sectionHeading} ${styles.sectionHeadingLater}`}>
              <h2>最新更新的部落格</h2>
              <Link href="/blogs/?sort=latest&dir=desc">依最新排序 →</Link>
            </div>
            {recentBlogs.length ? (
              <div className={styles.recentBlogs}>
                <ol>
                  {recentBlogs.map(({ blog, latest, missing, publishedAt }) => {
                    const href = externalHref(latest?.url);
                    const title = displayTitle(latest?.title).trim() || '未提供標題';
                    return (
                      <li key={blog.slug}>
                        <p className={styles.recentBlogName}>
                          <Link {...blogLink(blog.slug, blog.canonicalPath)} title={blog.name}>
                            <BlogIcon media={blog.slug} title={blog.name} />
                            <span>{blog.name}</span>
                          </Link>
                          {publishedAt && <time dateTime={publishedAt}>{taipei(publishedAt)}</time>}
                        </p>
                        {latest ? (
                          href ? (
                            <a
                              href={href}
                              data-analytics="open_original"
                              rel="noopener noreferrer"
                              className={styles.recentPost}
                              title={title}
                            >
                              {title}
                            </a>
                          ) : (
                            <p className={styles.recentPost} title={title}>
                              {title}
                            </p>
                          )
                        ) : (
                          <p className={styles.recentMissing}>{missing === 'none' ? '尚未收錄文章' : '最新文章標題暫缺'}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
                <Link href="/articles/" className={styles.more}>
                  探索更多文章 <span aria-hidden="true">→</span>
                </Link>
              </div>
            ) : (
              <p className={styles.notice}>部落格更新資料整理中。</p>
            )}
          </aside>
        </div>
        <div className={styles.band}>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <h2>我的閱讀</h2>
              <Link href="/my/">追蹤清單 →</Link>
            </div>
            <p className={styles.notice}>追蹤想持續閱讀的部落格，透過個人 RSS 或 OPML 把訂閱帶回自己的閱讀器。</p>
          </section>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <h2>沿著連結，認識新部落格</h2>
              <Link href="/relations/">關係圖 →</Link>
            </div>
            <p className={styles.notice}>低頻寫作也是持續寫作。我們分開記錄最後發文與抓取成功時間，不會因為久未更新就判定網站失效。</p>
          </section>
        </div>
      </div>
    </>
  );
}
