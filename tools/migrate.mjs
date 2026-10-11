import { readFile } from "node:fs/promises";
import { createDb } from "../src/db.mjs";

const { pool, close } = createDb();
try {
  const sql = await readFile(new URL("../db/001_init.sql", import.meta.url), "utf8");
  for (const statement of sql.split(/;\s*(?=CREATE TABLE)/).map((item) => item.trim()).filter(Boolean)) await pool.query(statement);
  console.log("blog_observe schema ready");
} finally {
  await close();
}
