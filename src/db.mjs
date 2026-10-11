import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "./schema.mjs";

export function parseDbUrl(value = process.env.BLOG_DB_URL) {
  if (!value) throw new Error("BLOG_DB_URL is required");
  const url = new URL(value);
  if (url.protocol !== "mysql:") throw new Error("BLOG_DB_URL must use mysql://");
  return { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) };
}

export function createDb(value = process.env.BLOG_DB_URL) {
  const pool = mysql.createPool({ ...parseDbUrl(value), charset: "utf8mb4", connectionLimit: 6, waitForConnections: true, queueLimit: 64, timezone: "Z", dateStrings: false, supportBigNumbers: true, connectTimeout: 5000 });
  return { db: drizzle(pool, { schema, mode: "default" }), pool, close: () => pool.end() };
}
