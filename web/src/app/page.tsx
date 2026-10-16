// Layout and CSS copied from tag.observe.tw homepage at afe0a65; blog data replaces news-specific measures.

import { Suspense } from 'react';
import BlogIcon from '@/components/BlogIcon';
import Link from '@/components/NoPrefetchLink';
import PostTags from '@/components/PostTags';
import { displayTitle, taipei } from '@/lib/api';
import { recentBlogRows } from '@/lib/home';
import { externalHref } from '@/lib/images';
import { blogLink } from '@/lib/page-links';
import { homeOverview } from '@/lib/public-api';
import { serializeJsonLd, siteSchema, staticPageMetadata } from '@/lib/seo';
import HomeMentionsSection from './_home/HomeMentions';
import HomeTopicCloud from './_home/HomeTopicCloud';
import HomeTopicRanking, { HomeTopicsPending } from './_home/HomeTopics';
import styles from './_home/home.module.css';
import MastheadCloud from './_home/MastheadCloud';
// Rendered per request with no-store reads (public-read.ts): no stored page can
// keep showing an article the gateway has since hidden. A failed read throws.
// Only the bounded overview is awaited here; the topic ranking and the masthead's
// cloud stream in their own Suspense (one shared topic read) and their failure
// throws to the same error boundary. The mark and tagline never wait for them.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/');
export default async function HomePage() {
  const data = await homeOverview();
  const recentBlogs = recentBlogRows(data, 10);
  const updated = data.updatedAt ? `${taipei(data.updatedAt)} 更新` : '等待資料更新';
  return (
    <>
      {/* Static site facts; serializeJsonLd escapes '<'. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteSchema()) }} />
      <div className={styles.home}>
        <MastheadCloud
          edition={updated}
          cloud={
            <Suspense fallback={null}>
              <HomeTopicCloud />
            </Suspense>
          }
        />
        <div className={styles.columns}>
          <aside className={styles.left} aria-label="最近共同話題">
            <div className={styles.sectionHeading}>
              <h2>最近共同話題</h2>
              <Link href="/topics/">完整排行 →</Link>
            </div>
            <Suspense fallback={<HomeTopicsPending />}>
              <HomeTopicRanking />
            </Suspense>
          </aside>
          <HomeMentionsSection mentions={data.mentions} />
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
                        {latest && <PostTags tags={latest.tags} total={latest.tagCount} max={3} className={styles.postTags} />}
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
      </div>
    </>
  );
}
