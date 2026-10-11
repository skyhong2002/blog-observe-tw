import rateLimit from '@fastify/rate-limit';
import * as cheerio from 'cheerio';
import Fastify, { LogController } from 'fastify';
import { registerLogin } from './auth/google-login.ts';
import { dbLoginStore } from './auth/store.ts';
import { createDb } from './db/client.ts';
import { createUiProxy } from './ui-proxy.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const sameOrigin = (request, origin) => !request.headers.origin || request.headers.origin === origin;

function rss(items, title, link) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(title)}</title><link>${esc(link)}</link><description>${esc(title)}</description>${items.map((item) => `<item><title>${esc(item.title)}</title><link>${esc(item.url)}</link><guid>${esc(item.guid || item.url)}</guid>${item.publishedAt ? `<pubDate>${esc(new Date(item.publishedAt).toUTCString())}</pubDate>` : ''}<description>${esc(item.summary || '')}</description></item>`).join('')}</channel></rss>`;
}

export async function buildApp(config, { logger = false, store = null } = {}) {
  const app = Fastify({ logger, logController: new LogController({ disableRequestLogging: true }), exposeHeadRoutes: true });
  const own = store || createDb(config.blogDbUrl);
  const { pool } = own;
  const startedAt = Date.now();
  await app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    max: 240,
    allowList: (request) => !request.headers['cf-connecting-ip'],
  });
  for (const type of ['application/xml', 'text/xml', 'application/x-opml']) {
    app.addContentTypeParser(type, { parseAs: 'string', bodyLimit: 1024 * 1024 }, (_request, body, done) => done(null, body));
  }

  app.get('/healthz', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    const [[row]] = await pool.query('SELECT COUNT(*) AS count FROM blogs');
    return {
      ok: true,
      service: 'blog.observe.tw',
      port: config.port,
      startedAt: new Date(startedAt).toISOString(),
      blogs: Number(row.count),
    };
  });
  app.get('/_migration/health', async () => ({
    status: 'ok',
    version: '0.3.0',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  }));

  app.get('/api/blogs', async (request) => {
    const limit = Math.min(200, Math.max(1, Number(request.query?.limit || 200)));
    const [rows] = await pool.query(
      'SELECT id,slug,name,url,canonical_host AS canonicalHost,category,status,status_label AS statusLabel,description,last_crawled_at AS lastCrawledAt,last_published_at AS lastPublishedAt FROM blogs ORDER BY name LIMIT ?',
      [limit],
    );
    return { blogs: rows };
  });
  app.get('/api/blogs/:slug', async (request, reply) => {
    const [blogs] = await pool.query(
      'SELECT id,slug,name,url,canonical_host AS canonicalHost,category,status,status_label AS statusLabel,description,source_name AS sourceName,source_row AS sourceRow,last_crawled_at AS lastCrawledAt,last_published_at AS lastPublishedAt FROM blogs WHERE slug=? LIMIT 1',
      [request.params.slug],
    );
    if (!blogs.length) return reply.code(404).send({ error: 'blog not found' });
    const [posts] = await pool.query(
      'SELECT guid,title,url,summary,author,published_at AS publishedAt,updated_at AS updatedAt,image_url AS imageUrl FROM posts WHERE blog_id=? ORDER BY COALESCE(published_at,updated_at,created_at) DESC LIMIT 50',
      [blogs[0].id],
    );
    return { blog: blogs[0], posts };
  });

  const login = registerLogin(app, config.login ? dbLoginStore(own.db) : null, config.login);
  const requireUser = async (request, reply) => {
    const user = await login.currentUser(request);
    if (!user) {
      reply.code(401).send({ error: 'login required' });
      return null;
    }
    return user;
  };
  app.get('/api/me/follows', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [follows] = await pool.query(
      'SELECT b.slug,b.name,b.url,b.category FROM user_follows f JOIN blogs b ON b.id=f.blog_id WHERE f.user_id=? ORDER BY b.name',
      [user.id],
    );
    return { follows };
  });
  app.route({
    method: ['POST', 'DELETE'],
    url: '/api/blogs/:slug/follow',
    handler: async (request, reply) => {
      if (!sameOrigin(request, config.publicOrigin)) return reply.code(403).send({ error: 'same-origin requests only' });
      const user = await requireUser(request, reply);
      if (!user) return;
      const [blogs] = await pool.query('SELECT id FROM blogs WHERE slug=? LIMIT 1', [request.params.slug]);
      if (!blogs.length) return reply.code(404).send({ error: 'blog not found' });
      if (request.method === 'POST')
        await pool.execute('INSERT IGNORE INTO user_follows (user_id,blog_id,created_at) VALUES (?,?,?)', [
          user.id,
          blogs[0].id,
          new Date(),
        ]);
      else await pool.execute('DELETE FROM user_follows WHERE user_id=? AND blog_id=?', [user.id, blogs[0].id]);
      return { following: request.method === 'POST', slug: request.params.slug };
    },
  });
  app.get('/me/feed.xml', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [items] = await pool.query(
      'SELECT p.guid,p.title,p.url,p.summary,p.published_at AS publishedAt FROM posts p JOIN user_follows f ON f.blog_id=p.blog_id WHERE f.user_id=? ORDER BY COALESCE(p.published_at,p.updated_at,p.created_at) DESC LIMIT 100',
      [user.id],
    );
    return reply
      .type('application/rss+xml; charset=utf-8')
      .send(rss(items, '我的 blog.observe.tw 閱讀清單', `${config.publicOrigin}/me/feed.xml`));
  });
  app.get('/me/opml', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [follows] = await pool.query(
      'SELECT b.name,b.url FROM user_follows f JOIN blogs b ON b.id=f.blog_id WHERE f.user_id=? ORDER BY b.name',
      [user.id],
    );
    const outlines = follows
      .filter((item) => item.url)
      .map(
        (item) =>
          `<outline type="rss" text="${esc(item.name)}" title="${esc(item.name)}" htmlUrl="${esc(item.url)}" xmlUrl="${esc(item.url)}"/>`,
      )
      .join('');
    return reply
      .type('text/x-opml; charset=utf-8')
      .header('content-disposition', 'attachment; filename=blog-observe.opml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>blog.observe.tw subscriptions</title></head><body>${outlines}</body></opml>`,
      );
  });
  app.post('/api/me/opml', async (request, reply) => {
    if (!sameOrigin(request, config.publicOrigin)) return reply.code(403).send({ error: 'same-origin requests only' });
    const user = await requireUser(request, reply);
    if (!user) return;
    const xml = typeof request.body === 'string' ? request.body : '';
    if (xml.length > 1024 * 1024) return reply.code(413).send({ error: 'OPML too large' });
    const $ = cheerio.load(xml, { xmlMode: true });
    let followed = 0;
    let candidates = 0;
    for (const element of $('outline')) {
      const url = $(element).attr('xmlUrl') || $(element).attr('htmlUrl');
      if (!url || !/^https?:\/\//i.test(url)) continue;
      const [known] = await pool.query('SELECT blog_id FROM blog_urls WHERE url=? LIMIT 1', [url]);
      if (known.length) {
        await pool.execute('INSERT IGNORE INTO user_follows (user_id,blog_id,created_at) VALUES (?,?,?)', [
          user.id,
          known[0].blog_id,
          new Date(),
        ]);
        followed += 1;
      } else {
        await pool.execute(
          'INSERT IGNORE INTO discovery_candidates (url,name,source_type,source_url,source_evidence,discovered_at) VALUES (?,?,?,?,?,?)',
          [
            url,
            $(element).attr('text') || $(element).attr('title') || null,
            'opml-import',
            '/api/me/opml',
            JSON.stringify({ userId: user.id }),
            new Date(),
          ],
        );
        candidates += 1;
      }
    }
    return { followed, candidates };
  });

  const proxyToUi = createUiProxy(config.uiOrigin);
  const handler = async (request, reply) => proxyToUi(request, reply);
  app.route({ method: ['GET', 'HEAD'], url: '/', handler });
  app.route({ method: ['GET', 'HEAD'], url: '/*', handler });
  app.addHook('onClose', async () => {
    if (!store) await own.close();
  });
  await app.ready();
  return app;
}
