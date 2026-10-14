import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { parseDbUrl } from '../app/src/db/client.ts';
import { auditTopicDisplay } from '../app/src/topics/display-audit.ts';
import { digest, normalizeTerm } from '../app/src/topics/policy.ts';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !['7', '30', '90'].includes(args[1])) throw Error('usage: topics:display-audit LABEL 7|30|90');
  const topicId = `tag:${digest(normalizeTerm(args[0]!))}`;
  if (!process.env.BLOG_DB_URL) throw Error('BLOG_DB_URL_required');
  const c = await mysql.createConnection({ ...parseDbUrl(process.env.BLOG_DB_URL), timezone: 'Z' });
  try {
    await c.query('START TRANSACTION READ ONLY');
    const result = await auditTopicDisplay(c as unknown as mysql.Pool, topicId, Number(args[1]));
    await c.rollback();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await c.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error('topic_display_audit_failed');
    process.exitCode = 1;
  });
