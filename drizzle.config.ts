import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './app/src/db/schema.ts',
  out: './app/src/db/migrations',
  // The baseline is a history marker for the pre-existing DB.  Commands that
  // generate migrations still need a URL, but this config never provisions
  // blog_observe by itself.
  dbCredentials: { url: process.env.BLOG_DB_URL ?? '' },
});
