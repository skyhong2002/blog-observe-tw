import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { parseDbUrl } from "../app/src/db/client.ts";

const input = process.argv[2] || "/home/deck/.t3/userdata/attachments/40e782cd-402d-4d62-892f-cd434b5ae862-a56fb4e7-3a53-4331-ab96-c2969bbdb069-csv.csv";
const source = await readFile(input);
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const text = source.toString("utf8").replace(/^\uFEFF/, "");

function parseCsv(value) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i], next = value[i + 1];
    if (quoted && char === "\"" && next === "\"") { cell += "\""; i += 1; continue; }
    if (char === "\"") { quoted = !quoted; continue; }
    if (!quoted && char === ",") { row.push(cell); cell = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some((item) => item !== "")) rows.push(row); }
  return rows;
}
function key(value) { return value.trim().toLocaleLowerCase("zh-Hant").replace(/\s+/g, " "); }
function slugFor(name, row) {
  const ascii = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${ascii || "seed"}-${row}`.slice(0, 170);
}
function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

const rows = parseCsv(text);
const records = rows.map((raw, index) => ({ row: index + 1, raw })).filter(({ raw }) => raw[0]?.trim() === "個人" && raw[3]?.trim());
const uniqueNames = new Set(records.map(({ raw }) => key(raw[3]))).size;
const totalDuplicates = records.length - uniqueNames;
const known = new Map([
  ["電腦王阿達", { slug: "kocpc", url: "https://www.kocpc.com.tw/", description: "科技、消費電子、3C 與生活工具的長期介紹與教學。" }],
  ["硬是要學", { slug: "soft4fun", url: "https://www.soft4fun.net/", description: "軟體、網路服務與數位工具的實用教學與整理。" }],
  ["雲爸 dacota.tw", { slug: "dacota", url: "https://dacota.tw/", description: "科技產品、生活觀察與使用心得，從作者視角持續記錄。" }],
  ["點子生活 saydigi", { slug: "saydigi", url: "https://www.saydigi.com/", description: "科技、生活與消費趨勢的內容整理，提供原站文章入口。" }],
]);
const connection = await mysql.createConnection(parseDbUrl());
const importedAt = new Date();
const firstRecordByName = new Map();
const blogByName = new Map();
let inserted = 0, duplicate = 0;
try {
  await connection.beginTransaction();
  for (const { row, raw } of records) {
    const name = raw[3].trim(), category = raw[1]?.trim() || "待分類", normalized = key(name);
    let blogId = blogByName.get(normalized);
    if (!blogId) {
      const detail = known.get(name);
      const slug = detail?.slug || slugFor(name, row);
      const [existing] = await connection.execute("SELECT id FROM blogs WHERE slug=?", [slug]);
      if (existing.length) blogId = existing[0].id;
      else {
        const [result] = await connection.execute(
          "INSERT INTO blogs (slug,name,url,canonical_host,category,description,status,status_label,source_sha256,source_row,source_name,source_category,source_values,discovered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [slug, name, detail?.url || null, detail ? hostOf(detail.url) : null, category, detail?.description || null, detail ? "verified" : "seed", detail ? "已核對網站" : "待核對", sourceSha256, row, name, category, JSON.stringify({ raw, trafficMonth: null, trafficUnit: null, note: "保留原值，尚未換算月份或單位" }), importedAt],
        );
        blogId = result.insertId;
      }
      blogByName.set(normalized, blogId);
      if (detail?.url) await connection.execute("INSERT IGNORE INTO blog_urls (blog_id,url,kind,is_primary,discovered_at) VALUES (?,?,?,?,?)", [blogId, detail.url, "verified-seed", true, importedAt]);
    }
    const [seen] = await connection.execute("SELECT id FROM seed_records WHERE source_sha256=? AND source_row=?", [sourceSha256, row]);
    if (seen.length) continue;
    const duplicateOf = firstRecordByName.get(normalized) || null;
    const [result] = await connection.execute(
      "INSERT INTO seed_records (source_path,source_sha256,source_row,original_name,original_category,original_values,blog_id,duplicate_of,imported_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [path.resolve(input), sourceSha256, row, name, category, JSON.stringify({ raw, trafficValue: raw[4] || null, trafficGrowth: raw[5] || null, trafficMonth: null, trafficUnit: null }), blogId, duplicateOf, importedAt],
    );
    firstRecordByName.set(normalized, firstRecordByName.get(normalized) || result.insertId);
    if (duplicateOf) duplicate += 1; else inserted += 1;
  }
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
const manifestDir = "/home/deck/.local/share/blog-observe";
await mkdir(manifestDir, { recursive: true });
await writeFile(path.join(manifestDir, "seed-import-manifest.json"), JSON.stringify({ sourcePath: path.resolve(input), sourceSha256, importedAt: importedAt.toISOString(), records: records.length, uniqueNames, duplicates: totalDuplicates, trafficConversion: "未轉換；CSV 欄位月份與單位待核對" }, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ sourceSha256, records: records.length, uniqueNames, inserted, duplicates: totalDuplicates }));
