import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.ts';

export type Db = MySql2Database<typeof schema>;

export interface ParsedDbUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parseDbUrl(url: string | undefined = process.env.BLOG_DB_URL): ParsedDbUrl {
  if (!url) throw new Error('BLOG_DB_URL is required (mysql://user:pass@host:port/db)');
  const parsed = new URL(url);
  if (parsed.protocol !== 'mysql:') throw new Error('BLOG_DB_URL must use mysql://');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) throw new Error('BLOG_DB_URL must include a database name');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

export function createDb(url = process.env.BLOG_DB_URL, { poolSize = 4 } = {}) {
  const pool = mysql.createPool({
    ...parseDbUrl(url),
    charset: 'utf8mb4',
    connectionLimit: poolSize,
    waitForConnections: true,
    queueLimit: 64,
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    connectTimeout: 5000,
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool, close: () => pool.end() };
}
