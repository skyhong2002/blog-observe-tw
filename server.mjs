import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDb } from "./src/db.mjs";
import * as cheerio from "cheerio";

const HOST = process.env.HOSTNAME || "127.0.0.1";
const PORT = Number(process.env.PORT || 18160);
const PUBLIC_ORIGIN = new URL(process.env.BLOG_PUBLIC_ORIGIN || "https://blog.observe.tw").origin;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
const GOOGLE_CALLBACK = `${PUBLIC_ORIGIN}/auth/google/callback`;
const SESSION_COOKIE = "blog_session";
const FLOW_COOKIE = "blog_oauth";
const SESSION_DAYS = 30;
const FLOW_SECONDS = 600;
const startedAt = new Date().toISOString();
const root = path.dirname(fileURLToPath(import.meta.url));
const seedBlogs = JSON.parse(await readFile(path.join(root, "data/blogs.json"), "utf8"));
const dbStore = process.env.BLOG_DB_URL ? createDb() : null;
let blogs = seedBlogs;

if (dbStore) {
  try {
    const [rows] = await dbStore.pool.execute("SELECT id,slug,name,url,category,status,status_label AS statusLabel,description,source_name AS sourceLabel,source_row AS sourceRow FROM blogs ORDER BY (status='verified') DESC, name ASC");
    blogs = rows.map((row) => ({ ...row, source: { label: row.sourceLabel || "seed", row: row.sourceRow || null } }));
  } catch (error) {
    console.error("database catalog unavailable; using seed fallback:", error instanceof Error ? error.message : "unknown error");
  }
}

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;

function readCookie(request, name) {
  for (const part of (request.headers.cookie || "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}
function safeNext(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return "/";
  if (value.startsWith("/auth/") || value.length > 512 || /[\u0000-\u001f]/.test(value)) return "/";
  return value;
}
async function currentUser(request) {
  const session = readCookie(request, SESSION_COOKIE);
  if (!session || session.length > 100) return null;
  if (!dbStore) return null;
  const [rows] = await dbStore.pool.execute("SELECT u.id,u.email,u.name,u.picture FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP()", [hash(session)]);
  return rows[0] || null;
}
function responseHeaders(type, length, extra = {}) {
  return { "Content-Type": type, "Content-Length": length, "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin", ...extra };
}
function send(res, status, type, body, extra = {}) {
  const value = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, responseHeaders(type, Buffer.byteLength(value), extra));
  res.end(value);
}
function redirect(res, location, status = 302, extra = {}) {
  res.writeHead(status, responseHeaders("text/plain; charset=utf-8", 0, { Location: location, ...extra }));
  res.end();
}
function layout(title, content, user = null) {
  const auth = user
    ? `<a class="muted" href="/me/feed.xml">我的 RSS</a><a class="muted" href="/me/opml">OPML</a><span class="user">${escapeHtml(user.name || user.email)}</span><form method="post" action="/auth/logout"><button class="ghost">登出</button></form>`
    : `<a class="button small" href="/auth/google?next=%2Fblogs">使用 Google 登入</a>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · blog.observe.tw</title><meta name="description" content="部落格觀察與閱讀入口">
<style>
:root{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb}*{box-sizing:border-box}body{margin:0}a{color:inherit}.shell{max-width:1120px;margin:0 auto;padding:0 24px}.top{border-bottom:1px solid #e4e8f0;background:#fff}.nav{height:72px;display:flex;align-items:center;gap:28px}.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:750;letter-spacing:-.02em}.mark{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;background:#6d4aff;color:#fff;font-size:14px}.navlinks{display:flex;gap:18px;color:#62708a;font-size:.94rem}.navlinks a{text-decoration:none}.navlinks a:hover{color:#6d4aff}.auth{margin-left:auto;display:flex;align-items:center;gap:12px;font-size:.9rem;color:#62708a}.user{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.button,button{border:0;border-radius:9px;padding:10px 15px;background:#6d4aff;color:#fff;font:inherit;font-weight:650;text-decoration:none;cursor:pointer}.button.small,.small{padding:8px 12px;font-size:.86rem}.ghost{padding:4px 0;background:none;color:#6d4aff;font-size:.86rem}.hero{padding:72px 0 50px;max-width:760px}.eyebrow{color:#6d4aff;font-size:.82rem;font-weight:750;letter-spacing:.12em;text-transform:uppercase}.hero h1{font-size:clamp(2.3rem,6vw,4.4rem);line-height:1.05;letter-spacing:-.065em;margin:14px 0 20px}.hero p{font-size:1.12rem;line-height:1.8;color:#62708a;margin:0}.section{padding:28px 0 72px}.sectionhead{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:18px}.section h2{font-size:1.35rem;margin:0;letter-spacing:-.03em}.muted{color:#74819a}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}.card{background:#fff;border:1px solid #e4e8f0;border-radius:16px;padding:20px;box-shadow:0 8px 24px #2b385508}.card h3{margin:0 0 9px;font-size:1.05rem}.card h3 a{text-decoration:none}.card h3 a:hover{color:#6d4aff}.card p{color:#68758e;line-height:1.6;margin:0 0 15px;font-size:.94rem}.meta{color:#8a95a8;font-size:.82rem;display:flex;gap:8px;flex-wrap:wrap}.pill{display:inline-flex;align-items:center;border-radius:99px;background:#f0edff;color:#5e40db;padding:4px 9px;font-size:.75rem;font-weight:650}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0}.search{flex:1;min-width:230px;border:1px solid #dbe1eb;border-radius:9px;padding:11px 13px;font:inherit;background:#fff}.back{display:inline-block;color:#6d4aff;text-decoration:none;margin-bottom:22px}.detail{background:#fff;border:1px solid #e4e8f0;border-radius:18px;padding:30px;max-width:780px}.detail h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.1;letter-spacing:-.055em;margin:0 0 16px}.detail p{font-size:1.05rem;line-height:1.8;color:#62708a}.detail .external{display:inline-block;margin-top:10px}.notice{background:#fff4d6;border:1px solid #f0d98c;border-radius:10px;padding:13px 15px;color:#755a16}.footer{padding:30px 0 60px;color:#8a95a8;font-size:.85rem}@media(max-width:680px){.nav{height:auto;min-height:72px;flex-wrap:wrap;padding:15px 0}.navlinks{order:3;width:100%;padding-bottom:8px}.auth{margin-left:auto}.hero{padding-top:52px}.shell{padding:0 18px}}
</style></head><body><header class="top"><div class="shell nav"><a class="brand" href="/"><span class="mark">BO</span><span>blog.observe.tw</span></a><nav class="navlinks"><a href="/blogs">探索部落格</a><a href="/blogs?sort=recent">最新收錄</a><a href="/about">關於</a></nav><div class="auth">${auth}</div></div></header><main class="shell">${content}</main><footer class="shell footer">blog.observe.tw · 透明地觀察部落格更新，連回原站閱讀。</footer></body></html>`;
}
function home(user) {
  const featured = blogs.slice(0, 4).map((blog) => `<article class="card"><div class="meta"><span class="pill">${escapeHtml(blog.category)}</span><span>${escapeHtml(blog.statusLabel)}</span></div><h3><a href="/blogs/${encodeURIComponent(blog.slug)}">${escapeHtml(blog.name)}</a></h3><p>${escapeHtml(blog.description)}</p><a class="muted" href="/blogs/${encodeURIComponent(blog.slug)}">查看網站 →</a></article>`).join("");
  return layout("部落格觀察", `<section class="hero"><div class="eyebrow">A directory for independent writing</div><h1>找到值得持續閱讀的部落格。</h1><p>blog.observe.tw 收錄台灣部落格與獨立網站，整理更新狀態、分類與原站入口，讓探索和訂閱回到作者自己的網站。</p><div class="toolbar"><a class="button" href="/blogs">瀏覽部落格目錄</a><a class="button small" href="/auth/google?next=%2Fblogs">登入以保存訂閱</a></div></section><section class="section"><div class="sectionhead"><h2>已核對的網站</h2><a class="muted" href="/blogs">查看全部 ${blogs.length} 個 →</a></div><div class="grid">${featured}</div></section>`, user);
}
function blogIndex(url, user) {
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();
  const category = (url.searchParams.get("category") || "").trim();
  const filtered = blogs.filter((blog) => (!query || `${blog.name} ${blog.description} ${blog.category}`.toLowerCase().includes(query)) && (!category || blog.category === category));
  const categories = [...new Set(blogs.map((blog) => blog.category))];
  const cards = filtered.map((blog) => `<article class="card"><div class="meta"><span class="pill">${escapeHtml(blog.category)}</span><span>${escapeHtml(blog.statusLabel)}</span></div><h3><a href="/blogs/${encodeURIComponent(blog.slug)}">${escapeHtml(blog.name)}</a></h3><p>${escapeHtml(blog.description || "尚未提供網站簡介。")}</p><div class="meta"><span>${escapeHtml(blog.url ? blog.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "網址待核對")}</span></div></article>`).join("");
  return layout("探索部落格", `<section class="section" style="padding-top:56px"><div class="sectionhead"><div><div class="eyebrow">Directory</div><h1 style="margin:10px 0 0;font-size:clamp(2rem,5vw,3.5rem);letter-spacing:-.055em">探索部落格</h1></div><span class="muted">${filtered.length} 個結果</span></div><form class="toolbar" method="get"><input class="search" type="search" name="q" value="${escapeHtml(url.searchParams.get("q") || "")}" placeholder="搜尋網站名稱或主題"><select class="search" name="category" aria-label="分類"><option value="">全部分類</option>${categories.map((item) => `<option value="${escapeHtml(item)}"${item === category ? " selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select><button type="submit">搜尋</button></form><div class="grid">${cards || `<div class="notice">找不到符合條件的網站。</div>`}</div></section>`, user);
}
async function blogDetail(slug, user) {
  const blog = blogs.find((item) => item.slug === slug);
  if (!blog) return null;
  const external = blog.url ? `<a class="button external" href="${escapeHtml(blog.url)}" rel="noopener noreferrer">前往原站閱讀 ↗</a>` : `<div class="notice">這個網站已列入 seed，網址仍待核對。</div>`;
  let postHtml = "";
  let followHtml = "";
  if (user && dbStore && blog.id) {
    const [followRows] = await dbStore.pool.execute("SELECT 1 FROM user_follows WHERE user_id=? AND blog_id=?", [user.id, blog.id]);
    followHtml = followRows.length ? `<form method="post" action="/api/blogs/${encodeURIComponent(blog.slug)}/follow"><button class="button" type="submit">已追蹤 · 取消追蹤</button></form>` : `<form method="post" action="/api/blogs/${encodeURIComponent(blog.slug)}/follow"><button class="button" type="submit">追蹤這個部落格</button></form>`;
  }
  if (dbStore && blog.id) {
    const [posts] = await dbStore.pool.execute("SELECT title,url,summary,published_at AS publishedAt,source_type AS sourceType FROM posts WHERE blog_id=? ORDER BY COALESCE(published_at,updated_at,created_at) DESC LIMIT 20", [blog.id]);
    postHtml = posts.length ? `<section class="section"><div class="sectionhead"><h2>最近收錄文章</h2><span class="muted">${posts.length} 篇</span></div><div class="grid">${posts.map((post) => `<article class="card"><div class="meta"><span class="pill">${escapeHtml(post.sourceType)}</span><span>${post.publishedAt ? escapeHtml(new Date(post.publishedAt).toLocaleDateString("zh-TW")) : "日期待確認"}</span></div><h3><a href="${escapeHtml(post.url)}" rel="noopener noreferrer">${escapeHtml(post.title)}</a></h3><p>${escapeHtml((post.summary || "").replace(/<[^>]+>/g, "").slice(0, 180))}</p></article>`).join("")}</div></section>` : "";
  }
  return layout(blog.name, `<section class="section" style="padding-top:56px"><a class="back" href="/blogs">← 返回部落格目錄</a><article class="detail"><div class="meta"><span class="pill">${escapeHtml(blog.category)}</span><span>${escapeHtml(blog.statusLabel)}</span></div><h1>${escapeHtml(blog.name)}</h1><p>${escapeHtml(blog.description || "目前只有來源名單資料，待完成網址核對與 RSS 偵測。")}</p><dl class="meta"><dt>網站</dt><dd>${blog.url ? `<a href="${escapeHtml(blog.url)}" rel="noopener noreferrer">${escapeHtml(blog.url)}</a>` : "待核對"}</dd><dt>資料來源</dt><dd>${escapeHtml(blog.source.label)} · 第 ${blog.source.row || "?"} 列</dd></dl><div class="toolbar">${external}${followHtml}</div></article></section>${postHtml}`, user);
}

function xmlEscape(value) { return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function xmlFeed(posts, title, link) {
  const items = posts.map((post) => `<item><title>${xmlEscape(post.title)}</title><link>${xmlEscape(post.url)}</link><guid isPermaLink="false">${xmlEscape(post.guid || post.url)}</guid><description>${xmlEscape((post.summary || "").replace(/<[^>]+>/g, "").slice(0, 1000))}</description>${post.publishedAt ? `<pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>` : ""}</item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xmlEscape(title)}</title><link>${xmlEscape(link)}</link><description>blog.observe.tw 個人閱讀清單</description>${items}</channel></rss>`;
}
async function readBody(request, limit = 1_000_000) {
  const chunks = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > limit) throw new Error("request body too large"); chunks.push(chunk); }
  return Buffer.concat(chunks).toString("utf8");
}
async function exchangeGoogleCode(code, verifier) {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, code_verifier: verifier, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: GOOGLE_CALLBACK, grant_type: "authorization_code" }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`token endpoint ${response.status}`);
  const payload = await response.json();
  if (typeof payload.id_token !== "string") throw new Error("no id_token");
  const verify = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(payload.id_token)}`, { signal: AbortSignal.timeout(15000) });
  if (!verify.ok) throw new Error(`tokeninfo ${verify.status}`);
  return verify.json();
}
function oauthStart(res, url) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return send(res, 503, "text/html; charset=utf-8", layout("登入尚未設定", `<section class="section" style="padding-top:72px"><div class="notice">Google 登入尚未完成伺服器設定，請稍後再試。</div></section>`));
  const state = token(), nonce = token(), verifier = token();
  const flow = Buffer.from(JSON.stringify({ state, nonce, verifier, next: safeNext(url.searchParams.get("next")) })).toString("base64url");
  const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  target.search = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_CALLBACK, response_type: "code", scope: "openid email profile", state, nonce, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", prompt: "select_account" }).toString();
  return redirect(res, target.toString(), 302, { "Set-Cookie": cookie(FLOW_COOKIE, flow, FLOW_SECONDS) });
}
async function handleOAuthCallback(request, res, url) {
  const clear = cookie(FLOW_COOKIE, "", 0);
  let flow = {};
  try { flow = JSON.parse(Buffer.from(readCookie(request, FLOW_COOKIE) || "", "base64url").toString("utf8")); } catch {}
  const fail = (reason) => redirect(res, `/login?error=${encodeURIComponent(reason)}`, 303, { "Set-Cookie": clear });
  if (!flow.state || !flow.nonce || !flow.verifier || url.searchParams.get("state") !== flow.state) return fail("state");
  if (url.searchParams.has("error")) return fail("cancelled");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048 || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return fail("invalid");
  try {
    const claims = await exchangeGoogleCode(code, flow.verifier);
    if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss) || claims.aud !== GOOGLE_CLIENT_ID || (claims.azp && claims.azp !== GOOGLE_CLIENT_ID) || claims.nonce !== flow.nonce || Number(claims.exp) * 1000 <= Date.now() || ![true, "true"].includes(claims.email_verified) || typeof claims.sub !== "string" || typeof claims.email !== "string") return fail("invalid");
    const user = { sub: claims.sub, email: claims.email.toLowerCase(), name: claims.name || null, picture: typeof claims.picture === "string" ? claims.picture : null };
    const session = token();
    if (!dbStore) return fail("database");
    const now = new Date();
    await dbStore.pool.execute("INSERT INTO users (google_sub,email,name,picture,created_at,last_login_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE email=VALUES(email),name=VALUES(name),picture=VALUES(picture),last_login_at=VALUES(last_login_at)", [user.sub, user.email, user.name, user.picture, now, now]);
    const [userRows] = await dbStore.pool.execute("SELECT id FROM users WHERE google_sub=?", [user.sub]);
    await dbStore.pool.execute("INSERT INTO user_sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)", [hash(session), userRows[0].id, now, new Date(now.getTime() + SESSION_DAYS * 86400000)]);
    return redirect(res, safeNext(flow.next), 303, { "Set-Cookie": [clear, cookie(SESSION_COOKIE, session, SESSION_DAYS * 86400)] });
  } catch (error) {
    console.warn("google login exchange failed:", error instanceof Error ? error.message : "unknown error");
    return fail("failed");
  }
}
const server = http.createServer(async (request, res) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || HOST}`);
  const user = await currentUser(request);
  try {
    if (request.method === "GET" && url.pathname === "/healthz") return send(res, 200, "application/json; charset=utf-8", { ok: true, service: "blog.observe.tw", port: PORT, startedAt, auth: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET), blogs: blogs.length });
    if (request.method === "GET" && url.pathname === "/auth/me") return send(res, 200, "application/json; charset=utf-8", { enabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET), user });
    if (request.method === "GET" && url.pathname === "/auth/google") return oauthStart(res, url);
    if (request.method === "GET" && url.pathname === "/auth/google/callback") return handleOAuthCallback(request, res, url);
    if (request.method === "POST" && url.pathname === "/auth/logout") { const session = readCookie(request, SESSION_COOKIE); if (session && dbStore) await dbStore.pool.execute("DELETE FROM user_sessions WHERE token_hash=?", [hash(session)]); return redirect(res, "/", 303, { "Set-Cookie": cookie(SESSION_COOKIE, "", 0) }); }
    if (url.pathname.startsWith("/api/blogs/") && url.pathname.endsWith("/follow") && ["POST", "DELETE"].includes(request.method)) {
      if (!user) return send(res, 401, "application/json; charset=utf-8", { error: "sign in first" });
      if (request.headers.origin && request.headers.origin !== PUBLIC_ORIGIN) return send(res, 403, "application/json; charset=utf-8", { error: "same-origin requests only" });
      const slug = decodeURIComponent(url.pathname.slice("/api/blogs/".length, -"/follow".length));
      const blog = blogs.find((item) => item.slug === slug);
      if (!blog?.id || !dbStore) return send(res, 404, "application/json; charset=utf-8", { error: "blog not found" });
      if (request.method === "POST") await dbStore.pool.execute("INSERT IGNORE INTO user_follows (user_id,blog_id,created_at) VALUES (?,?,?)", [user.id, blog.id, new Date()]);
      else await dbStore.pool.execute("DELETE FROM user_follows WHERE user_id=? AND blog_id=?", [user.id, blog.id]);
      if (request.headers.accept?.includes("text/html")) return redirect(res, "/blogs/" + encodeURIComponent(slug), 303);
      return send(res, 200, "application/json; charset=utf-8", { following: request.method === "POST", slug });
    }
    if (request.method === "GET" && url.pathname === "/api/me/follows") {
      if (!user || !dbStore) return send(res, 401, "application/json; charset=utf-8", { error: "sign in first" });
      const [follows] = await dbStore.pool.execute("SELECT b.slug,b.name,b.url,b.category FROM user_follows f JOIN blogs b ON b.id=f.blog_id WHERE f.user_id=? ORDER BY b.name", [user.id]);
      return send(res, 200, "application/json; charset=utf-8", { follows });
    }
    if (request.method === "GET" && url.pathname === "/me/feed.xml") {
      if (!user || !dbStore) return send(res, 401, "text/plain; charset=utf-8", "Sign in first\n");
      const [items] = await dbStore.pool.execute("SELECT p.guid,p.title,p.url,p.summary,p.published_at AS publishedAt FROM posts p JOIN user_follows f ON f.blog_id=p.blog_id WHERE f.user_id=? ORDER BY COALESCE(p.published_at,p.updated_at,p.created_at) DESC LIMIT 100", [user.id]);
      return send(res, 200, "application/rss+xml; charset=utf-8", xmlFeed(items, "我的 blog.observe.tw 閱讀清單", PUBLIC_ORIGIN + "/me/feed.xml"), { "Content-Disposition": "inline; filename=blog-observe-feed.xml" });
    }
    if (request.method === "GET" && url.pathname === "/me/opml") {
      if (!user || !dbStore) return send(res, 401, "text/plain; charset=utf-8", "Sign in first\n");
      const [follows] = await dbStore.pool.execute("SELECT b.name,b.url FROM user_follows f JOIN blogs b ON b.id=f.blog_id WHERE f.user_id=? ORDER BY b.name", [user.id]);
      const outlines = follows.filter((item) => item.url).map((item) => `<outline type="rss" text="${xmlEscape(item.name)}" title="${xmlEscape(item.name)}" htmlUrl="${xmlEscape(item.url)}" xmlUrl="${xmlEscape(item.url)}"/>`).join("");
      const body = `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>blog.observe.tw subscriptions</title></head><body>${outlines}</body></opml>`;
      return send(res, 200, "text/x-opml; charset=utf-8", body, { "Content-Disposition": "attachment; filename=blog-observe.opml" });
    }
    if (request.method === "POST" && url.pathname === "/api/me/opml") {
      if (!user || !dbStore) return send(res, 401, "application/json; charset=utf-8", { error: "sign in first" });
      if (request.headers.origin && request.headers.origin !== PUBLIC_ORIGIN) return send(res, 403, "application/json; charset=utf-8", { error: "same-origin requests only" });
      const body = await readBody(request);
      const $ = cheerio.load(body, { xmlMode: true });
      let followed = 0, candidates = 0;
      for (const element of $("outline").toArray()) {
        const xmlUrl = $(element).attr("xmlUrl") || $(element).attr("htmlUrl");
        if (!xmlUrl) continue;
        const [known] = await dbStore.pool.execute("SELECT blog_id FROM blog_urls WHERE url=?", [xmlUrl]);
        if (known.length) { await dbStore.pool.execute("INSERT IGNORE INTO user_follows (user_id,blog_id,created_at) VALUES (?,?,?)", [user.id, known[0].blog_id, new Date()]); followed += 1; }
        else { await dbStore.pool.execute("INSERT IGNORE INTO discovery_candidates (url,name,source_type,source_url,source_evidence,discovered_at) VALUES (?,?,?,?,?,?)", [xmlUrl, $(element).attr("text") || $(element).attr("title") || null, "opml-import", "/api/me/opml", JSON.stringify({ userId: user.id }), new Date()]); candidates += 1; }
      }
      return send(res, 200, "application/json; charset=utf-8", { followed, candidates });
    }
    if (request.method === "GET" && url.pathname === "/login") return send(res, 200, "text/html; charset=utf-8", layout("登入", `<section class="section" style="padding-top:72px"><div class="detail"><div class="eyebrow">Google sign-in</div><h1>登入 blog.observe.tw</h1><p>登入後可以在後續版本保存追蹤中的部落格與閱讀清單。</p>${url.searchParams.get("error") ? `<div class="notice">登入未完成（${escapeHtml(url.searchParams.get("error"))}），請重新嘗試。</div>` : ""}<a class="button external" href="/auth/google?next=%2Fblogs">使用 Google 登入</a></div></section>`, user));
    if (request.method === "GET" && url.pathname === "/about") return send(res, 200, "text/html; charset=utf-8", layout("關於", `<section class="section" style="padding-top:56px"><article class="detail"><div class="eyebrow">About</div><h1>透明地觀察部落格。</h1><p>本站第一版先提供可追溯的網站目錄與原站入口。收錄狀態、分類與來源列號會保留在資料中，後續再加入 RSS 抓取、文章索引與訂閱。</p></article></section>`, user));
    if (request.method === "GET" && url.pathname === "/api/blogs") return send(res, 200, "application/json; charset=utf-8", { blogs });
    if (request.method === "GET" && url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", home(user));
    if (request.method === "GET" && url.pathname === "/blogs") return send(res, 200, "text/html; charset=utf-8", blogIndex(url, user));
    if (request.method === "GET" && url.pathname.startsWith("/blogs/")) { const page = await blogDetail(decodeURIComponent(url.pathname.slice("/blogs/".length)), user); return page ? send(res, 200, "text/html; charset=utf-8", page) : send(res, 404, "text/plain; charset=utf-8", "Not Found\n"); }
    return send(res, 404, "text/plain; charset=utf-8", "Not Found\n");
  } catch (error) {
    console.error("request failed:", error);
    return send(res, 500, "text/plain; charset=utf-8", "Internal Server Error\n");
  }
});
server.listen(PORT, HOST, () => console.log(`blog.observe.tw listening on http://${HOST}:${PORT}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
