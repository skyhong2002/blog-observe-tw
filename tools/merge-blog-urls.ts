import { createDb } from '../app/src/db/client.ts';

const [fromSlug, toSlug] = process.argv.slice(2);
if (!fromSlug || !toSlug) throw new Error('usage: npm run blogs:merge -- old-slug new-slug [--apply]');
const apply = process.argv.includes('--apply');
const store = createDb();
try {
  const [blogs] = (await store.pool.query('SELECT id,slug,name,canonical_host AS canonicalHost,status FROM blogs WHERE slug IN (?,?)', [
    fromSlug,
    toSlug,
  ])) as [Array<{ id: number; slug: string; name: string; canonicalHost: string | null; status: string }>, unknown];
  const from = blogs.find((blog) => blog.slug === fromSlug);
  const to = blogs.find((blog) => blog.slug === toSlug);
  if (!from || !to) throw new Error('both source and target slugs must exist');
  const commonPlatform = ['blogspot.com', 'wordpress.com', 'medium.com', 'pixnet.net', 'plurk.com'].some(
    (host) => from.canonicalHost?.endsWith(host) || to.canonicalHost?.endsWith(host),
  );
  if (commonPlatform) throw new Error('refusing automatic merge on a shared publishing platform; confirm author identity first');
  const [urls] = (await store.pool.query('SELECT id,url,kind,is_primary AS isPrimary FROM blog_urls WHERE blog_id=?', [from.id])) as [
    Array<{ id: number; url: string; kind: string; isPrimary: boolean }>,
    unknown,
  ];
  const plan = { from: from.slug, to: to.slug, aliases: urls.map((url) => url.url), apply };
  if (!apply) {
    console.log(JSON.stringify({ ...plan, action: 'dry-run; rerun with --apply after human confirmation' }, null, 2));
  } else {
    const connection = await store.pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const url of urls)
        await connection.execute('UPDATE blog_urls SET blog_id=?,kind="moved",is_primary=FALSE WHERE id=?', [to.id, url.id]);
      await connection.execute('UPDATE blogs SET status="moved",status_label="已搬家，指向合併站點" WHERE id=?', [from.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    console.log(JSON.stringify({ ...plan, action: 'applied', sourcePreserved: true }, null, 2));
  }
} finally {
  await store.close();
}
