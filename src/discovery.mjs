import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

import { USER_AGENT } from "./feed.mjs";

const lockPath = "/home/deck/.local/share/observe-similarweb-rate-limit.lock";
const budgetPath = "/home/deck/.local/share/observe-similarweb-rate-budget.json";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeUrl = (value) => {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
};

async function fetchPage(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(url + " returned " + response.status);
  return response.text();
}

async function acquireGlobalBudget() {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try { handle = await open(lockPath, "wx"); }
  catch {
    try { if (Date.now() - (await stat(lockPath)).mtimeMs > 900000) { await writeFile(lockPath, String(process.pid)); handle = await open(lockPath, "wx"); } }
    catch { return null; }
  }
  if (!handle) return null;
  await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
  await handle.close();
  return async () => { try { await unlink(lockPath); } catch {} };
}

async function consumeBudget() {
  const today = new Date().toISOString().slice(0, 10);
  let current = { day: today, count: 0, blockedUntil: 0 };
  try { current = JSON.parse(await readFile(budgetPath, "utf8")); } catch {}
  if (current.day !== today) current = { day: today, count: 0, blockedUntil: 0 };
  if (Date.now() < current.blockedUntil || current.count >= 10) return false;
  current.count += 1;
  await writeFile(budgetPath, JSON.stringify(current) + "\n", { mode: 0o600 });
  return true;
}

async function saveCandidates(pool, candidates, sourceType, sourceUrl) {
  let inserted = 0;
  for (const candidate of candidates) {
    const url = normalizeUrl(candidate.url);
    if (!url || new URL(url).hostname === new URL(sourceUrl).hostname) continue;
    const evidence = JSON.stringify({ anchorText: candidate.anchorText || null, sourceUrl, fetchedAt: new Date().toISOString(), fingerprint: createHash("sha256").update(url).digest("hex") });
    const [result] = await pool.execute("INSERT IGNORE INTO discovery_candidates (url,name,source_type,source_url,source_evidence,discovered_at) VALUES (?,?,?,?,?,?)", [url, candidate.name || candidate.anchorText || null, sourceType, sourceUrl, evidence, new Date()]);
    inserted += result.affectedRows;
  }
  return inserted;
}

export async function discoverBlogblog({ pool }) {
  const pages = ["https://blogblog.club/blogrollroll", "https://blogblog.club/party", "https://blogblog.club/random"];
  const results = [];
  for (const sourceUrl of pages) {
    try {
      const html = await fetchPage(sourceUrl);
      const $ = cheerio.load(html);
      const candidates = $("a[href]").toArray().map((element) => ({ url: $(element).attr("href"), name: $(element).text().trim(), anchorText: $(element).text().trim() }));
      results.push({ sourceUrl, candidates: await saveCandidates(pool, candidates, "blogblog-club", sourceUrl) });
    } catch (error) { results.push({ sourceUrl, error: error instanceof Error ? error.message : "unknown error" }); }
    await delay(1500);
  }
  return { source: "blogblog-club", results };
}

function collectUrls(value, out = []) {
  if (typeof value === "string") {
    const url = normalizeUrl(value);
    if (url) out.push(url);
  } else if (Array.isArray(value)) for (const item of value) collectUrls(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectUrls(item, out);
  return [...new Set(out)];
}

export async function discoverSimilarSites({ pool, domains }) {
  if (process.env.BLOG_SIMILARWEB_ENABLED !== "1") return { source: "similarweb-similar-sites", skipped: "disabled; set BLOG_SIMILARWEB_ENABLED=1 only after shared-budget review" };
  const release = await acquireGlobalBudget();
  if (!release) return { source: "similarweb-similar-sites", skipped: "global rate-limit lock busy" };
  try {
    const template = process.env.BLOG_SIMILARWEB_SIMILAR_SITES_URL_TEMPLATE || "https://data.similarweb.com/api/v1/similar-sites?domain={domain}";
    const results = [];
    for (const domain of [...new Set(domains)].slice(0, 10)) {
      if (!await consumeBudget()) { results.push({ domain, skipped: "daily budget exhausted" }); break; }
      const endpoint = template.replace("{domain}", encodeURIComponent(domain));
      try {
        const response = await fetch(endpoint, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0", origin: "chrome-extension://hoklmmgfnpapgjgcpechhaamimifchmp", "x-extension-version": "6.12.0" }, signal: AbortSignal.timeout(20000) });
        if ([401, 403, 429].includes(response.status)) {
          let current = { day: new Date().toISOString().slice(0, 10), count: 0 };
          try { current = JSON.parse(await readFile(budgetPath, "utf8")); } catch {}
          current.blockedUntil = Date.now() + 86400000;
          await writeFile(budgetPath, JSON.stringify(current) + "\n", { mode: 0o600 });
          results.push({ domain, blocked: response.status });
          break;
        }
        if (!response.ok) throw new Error("HTTP " + response.status);
        const urls = collectUrls(await response.json()).filter((url) => !url.includes("similarweb.com"));
        const inserted = await saveCandidates(pool, urls.map((url) => ({ url })), "similarweb-similar-sites", endpoint);
        results.push({ domain, inserted });
      } catch (error) { results.push({ domain, error: error instanceof Error ? error.message : "unknown error" }); }
      await delay(5000);
    }
    return { source: "similarweb-similar-sites", results };
  } finally { await release(); }
}
