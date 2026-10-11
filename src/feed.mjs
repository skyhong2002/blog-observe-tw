import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";

export const USER_AGENT = "blog.observe.tw/0.2 (+https://blog.observe.tw/about; mailto:b@blog.observe.tw)";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", removeNSPrefix: true, parseTagValue: false });
const hostNextAt = new Map();
const DEFAULT_DELAY_MS = 1200;
const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const textOf = (value) => {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return textOf(value["#text"] ?? value.text ?? value.href ?? "");
  return "";
};
const absolute = (value, base) => {
  try { return new URL(textOf(value), base).toString(); } catch { return null; }
};
const dateOf = (value) => {
  const date = new Date(textOf(value));
  return Number.isNaN(date.getTime()) ? null : date;
};
const shortHash = (value) => createHash("sha256").update(value).digest("hex");

async function robotsAllows(url) {
  const origin = new URL(url).origin;
  const response = await fetch(origin + "/robots.txt", { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) return true;
  const lines = (await response.text()).split(/\r?\n/);
  let applies = false, disallow = [];
  for (const line of lines) {
    const parts = line.split("#", 1)[0].split(":", 2);
    const key = parts[0]?.trim().toLowerCase(), value = parts[1]?.trim() || "";
    if (key === "user-agent") { applies = value === "*" || USER_AGENT.toLowerCase().includes(value.toLowerCase()); if (applies) disallow = []; }
    if (applies && key === "disallow" && value) disallow.push(value);
  }
  const pathname = new URL(url).pathname;
  return !disallow.some((rule) => pathname.startsWith(rule));
}

async function politeFetch(url, headers = {}) {
  const host = new URL(url).host;
  const previous = hostNextAt.get(host) || 0;
  const wait = previous - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  hostNextAt.set(host, Date.now() + DEFAULT_DELAY_MS);
  if (!await robotsAllows(url)) throw new Error("robots disallow " + url);
  return fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8", ...headers }, redirect: "follow", signal: AbortSignal.timeout(20000) });
}

function discoverLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $("link[rel~='alternate'], link[rel~='feed'], link[rel~='index']").each((_, element) => {
    const href = $(element).attr("href"), type = ($(element).attr("type") || "").toLowerCase();
    if (href && (type.includes("rss") || type.includes("atom") || type.includes("xml"))) links.push({ url: absolute(href, baseUrl), type: type.includes("atom") ? "atom" : "rss" });
  });
  for (const candidate of ["/feed/", "/feed.xml", "/rss.xml", "/atom.xml", "/sitemap.xml"]) {
    const url = absolute(candidate, baseUrl);
    if (url && !links.some((item) => item.url === url)) links.push({ url, type: candidate.includes("sitemap") ? "sitemap" : candidate.includes("atom") ? "atom" : "rss" });
  }
  return links.filter((item) => item.url);
}

function parseFeed(xml, baseUrl) {
  const root = parser.parse(xml);
  const channel = root.rss?.channel;
  if (channel) return asArray(channel.item).map((item) => ({
    guid: textOf(item.guid || item.link || item.title), url: absolute(item.link, baseUrl) || baseUrl,
    title: textOf(item.title) || "未命名文章", summary: textOf(item.description || item["content:encoded"]),
    author: textOf(item.author || item.creator), publishedAt: dateOf(item.pubDate || item.published || item.date),
    updatedAt: dateOf(item.updated || item.pubDate), imageUrl: absolute(item.enclosure?.["@_url"] || item.image?.url, baseUrl),
  }));
  const atom = root.feed;
  if (atom) return asArray(atom.entry).map((item) => {
    const links = asArray(item.link);
    const link = links.find((candidate) => candidate["@_rel"] === "alternate") || links[0];
    return {
      guid: textOf(item.id || link?.["@_href"] || item.title), url: absolute(link?.["@_href"] || link, baseUrl) || baseUrl,
      title: textOf(item.title) || "未命名文章", summary: textOf(item.summary || item.content),
      author: textOf(item.author?.name || item.author), publishedAt: dateOf(item.published || item.updated),
      updatedAt: dateOf(item.updated || item.published), imageUrl: null,
    };
  });
  return [];
}

function parseSitemap(xml, baseUrl) {
  const root = parser.parse(xml);
  return asArray(root.urlset?.url).map((item) => {
    const url = absolute(item.loc, baseUrl);
    return url ? { guid: url, url, title: url.split("/").filter(Boolean).at(-1) || url, summary: "", author: null, publishedAt: dateOf(item.lastmod), updatedAt: dateOf(item.lastmod), imageUrl: null } : null;
  }).filter(Boolean);
}

export async function discoverFeedUrls(blogUrl) {
  const response = await politeFetch(blogUrl);
  if (!response.ok) throw new Error("homepage " + response.status);
  return discoverLinks(await response.text(), blogUrl);
}

export async function crawlBlog({ pool }, blog) {
  const now = new Date();
  let links;
  try { links = await discoverFeedUrls(blog.url); } catch (error) {
    await pool.execute("UPDATE blogs SET last_crawled_at=? WHERE id=?", [now, blog.id]);
    throw error;
  }
  let total = 0, sourceCount = 0;
  for (const source of links) {
    const [saved] = await pool.execute("SELECT * FROM feed_sources WHERE url=?", [source.url]);
    const prior = saved[0], headers = {};
    if (prior?.etag) headers["if-none-match"] = prior.etag;
    if (prior?.last_modified) headers["if-modified-since"] = prior.last_modified;
    let response;
    try { response = await politeFetch(source.url, headers); } catch {
      await pool.execute("INSERT INTO feed_sources (blog_id,url,type,last_error_at,consecutive_failures) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE last_error_at=VALUES(last_error_at),consecutive_failures=consecutive_failures+1", [blog.id, source.url, source.type, now]);
      continue;
    }
    if (response.status === 304) continue;
    if (!response.ok) {
      await pool.execute("INSERT INTO feed_sources (blog_id,url,type,last_error_at,consecutive_failures) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE last_error_at=VALUES(last_error_at),consecutive_failures=consecutive_failures+1", [blog.id, source.url, source.type, now]);
      continue;
    }
    const body = await response.text();
    const entries = source.type === "sitemap" ? parseSitemap(body, source.url) : parseFeed(body, source.url);
    await pool.execute("INSERT INTO feed_sources (blog_id,url,type,etag,last_modified,last_success_at,consecutive_failures) VALUES (?,?,?,?,?,?,0) ON DUPLICATE KEY UPDATE etag=VALUES(etag),last_modified=VALUES(last_modified),last_success_at=VALUES(last_success_at),consecutive_failures=0", [blog.id, source.url, source.type, response.headers.get("etag"), response.headers.get("last-modified"), now]);
    sourceCount += 1;
    for (const entry of entries) {
      const contentHash = shortHash(entry.title + "\n" + entry.summary);
      await pool.execute("INSERT INTO posts (blog_id,guid,url,title,summary,author,published_at,updated_at,image_url,content_hash,source_type,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE url=VALUES(url),title=VALUES(title),summary=VALUES(summary),author=VALUES(author),published_at=VALUES(published_at),updated_at=VALUES(updated_at),image_url=VALUES(image_url),content_hash=VALUES(content_hash)", [blog.id, entry.guid.slice(0, 1024), entry.url.slice(0, 1024), entry.title.slice(0, 512), entry.summary || null, entry.author || null, entry.publishedAt, entry.updatedAt, entry.imageUrl, contentHash, source.type, now]);
      total += 1;
    }
  }
  await pool.execute("UPDATE blogs SET last_crawled_at=?,last_published_at=COALESCE((SELECT MAX(published_at) FROM posts WHERE blog_id=?),last_published_at) WHERE id=?", [now, blog.id, blog.id]);
  return { blog: blog.slug, sources: sourceCount, posts: total };
}
