import { createDb } from "../src/db.mjs";
import { crawlBlog } from "../src/feed.mjs";

const slug = process.argv.find((arg) => arg.startsWith("--slug="))?.slice(7) || null;
const store = createDb();
try {
  const [blogs] = await store.pool.execute("SELECT id,slug,name,url FROM blogs WHERE status='verified' AND url IS NOT NULL" + (slug ? " AND slug=?" : "") + " ORDER BY id", slug ? [slug] : []);
  const results = [];
  for (const blog of blogs) {
    try { results.push({ ok: true, ...(await crawlBlog(store, blog)) }); }
    catch (error) { results.push({ ok: false, blog: blog.slug, error: error instanceof Error ? error.message : "unknown error" }); }
  }
  console.log(JSON.stringify({ crawledAt: new Date().toISOString(), results }, null, 2));
} finally {
  await store.close();
}
