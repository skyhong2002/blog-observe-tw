// Layout and CSS copied from tag.observe.tw homepage at afe0a65; blog data replaces news-specific measures.

import Link from 'next/link';
import BlogIcon from '@/components/BlogIcon';
import { gateway, overview, plainText, taipei } from '@/lib/api';
import type { Topics } from '@/lib/topics';
import styles from './_home/home.module.css';
import MastheadCloud from './_home/MastheadCloud';
import NewsImage from './_home/NewsImage';
export const dynamic = 'force-dynamic';
export default async function HomePage() {
  const [data, topics] = await Promise.all([overview(), gateway<Topics>('/api/topics?days=30')]);
  const [lead, ...rest] = data.posts;
  const updated = data.updatedAt ? `${taipei(data.updatedAt)} 更新` : '等待資料更新';
  return (
    <div className={styles.home}>
      <MastheadCloud edition={updated} tags={data.tags} />
      <div className={styles.columns}>
        <aside className={styles.left} aria-label="標籤排行與作者">
          <div className={styles.sectionHeading}>
            <h2>最近共同話題</h2>
            <Link href="/topics/">完整排行 →</Link>
          </div>
          {topics?.items.length ? (
            <ol className={styles.ranking}>
              {topics.items.slice(0, 8).map((tag, i) => (
                <li key={tag.id}>
                  <Link href={`/topics/${encodeURIComponent(tag.id)}/?days=30`}>
                    <span className={styles.rank}>{String(i + 1).padStart(2, '0')}</span>
                    <span className={styles.rankBody}>
                      <strong>{tag.label}</strong>
                      <small>
                        {tag.blogs} 個部落格 · {tag.posts} 篇 · {tag.source === 'rss-category' ? 'RSS' : '共同詞彙'}
                      </small>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.notice}>{topics ? '最近 30 天尚無足夠的共同話題。' : '話題資料暫時無法讀取。'}</p>
          )}
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
                <a
                  href={lead.url ?? `/blogs/${lead.blogSlug}/`}
                  className={styles.heroImage}
                  tabIndex={-1}
                  aria-label={`閱讀：${lead.title}`}
                >
                  <NewsImage src={lead.imageUrl ?? null} priority />
                </a>
                <div className={styles.heroContent}>
                  <span className={styles.heroBadge}>最近發文</span>
                  <h3>
                    <a href={lead.url ?? `/blogs/${lead.blogSlug}/`} className={styles.heroLink} rel="noopener noreferrer">
                      {lead.title}
                    </a>
                  </h3>
                  <p className={styles.source}>
                    <Link href={`/blogs/${lead.blogSlug}/`} className="inline-flex items-center gap-1.5">
                      {lead.blogSlug && <BlogIcon media={lead.blogSlug} title={lead.blogName} />}
                      {lead.blogName}
                    </Link>
                    <span>· {taipei(lead.publishedAt)}</span>
                  </p>
                  <p className="line-clamp-5 text-sm leading-7 text-zinc-600 dark:text-zinc-400">{plainText(lead.summary)}</p>
                  <div className={styles.heroFoot}>
                    <span>{lead.author}</span>
                    <a href={lead.url ?? `/blogs/${lead.blogSlug}/`} rel="noopener noreferrer">
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
                        <a href={post.url ?? `/blogs/${post.blogSlug}/`} rel="noopener noreferrer">
                          {post.title}
                        </a>
                      </h3>
                      <p className={styles.source}>
                        <Link href={`/blogs/${post.blogSlug}/`} className="inline-flex items-center gap-1.5">
                          {post.blogSlug && <BlogIcon media={post.blogSlug} title={post.blogName} />}
                          {post.blogName}
                        </Link>
                        <span>· {taipei(post.publishedAt)}</span>
                      </p>
                    </div>
                    <a
                      href={post.url ?? `/blogs/${post.blogSlug}/`}
                      className={styles.thumbnail}
                      tabIndex={-1}
                      aria-label={`閱讀：${post.title}`}
                    >
                      <NewsImage src={post.imageUrl ?? null} />
                    </a>
                  </article>
                ))}
              </div>
              <Link href="/articles/" className={styles.more}>
                探索更多文章 →
              </Link>
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
            <h2>最近更新的部落格</h2>
          </div>
          <div className={styles.headlineList}>
            {data.blogs
              .filter((blog) => blog.lastPublishedAt)
              .sort((a, b) => Date.parse(b.lastPublishedAt ?? '') - Date.parse(a.lastPublishedAt ?? ''))
              .slice(0, 4)
              .map((blog) => (
                <article className={styles.headlineCard} key={blog.slug}>
                  <h3>
                    <Link href={`/blogs/${blog.slug}/`} className="inline-flex items-center gap-1.5">
                      <BlogIcon media={blog.slug} title={blog.name} />
                      {blog.name}
                    </Link>
                  </h3>
                  <div className={styles.headlineSource}>
                    <p className={styles.headlineByline}>
                      {blog.category ?? '未分類'} · {taipei(blog.lastPublishedAt)}
                    </p>
                    <p className={styles.comparedTitle}>{blog.description || '前往原站，閱讀作者的完整文章。'}</p>
                  </div>
                </article>
              ))}
          </div>
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
  );
}
