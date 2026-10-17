import rateLimit from '@fastify/rate-limit';
import * as cheerio from 'cheerio';
import Fastify, { LogController } from 'fastify';
import { isAdmin } from './admin/identity.ts';
import { registerAdminRoutes } from './admin/routes.ts';
import { registerAiRoutes } from './ai/routes.ts';
import { registerLogin } from './auth/google-login.ts';
import { dbLoginStore } from './auth/store.ts';
import { registerBlogGenreRoutes } from './blog-genres/routes.ts';
import { readBlogGenres } from './blog-genres/store.ts';
import { installPrivateCachePolicy } from './cache-policy.ts';
import { loadCatalog } from './catalog.js';
import { loadAuthorCatalog } from './catalog-authors.js';
import { registerContentRoutes } from './content/routes.ts';
import { createDb } from './db/client.ts';
import { loadOverview } from './overview.js';
import { overviewFailureDetails } from './overview-diagnostics.ts';
import { withPostTags } from './post-tags.ts';
import { crawlIntervalHours, postingIntervalHours } from './posting-interval.js';
import { gatewayRateKey, gatewayRateMax } from './public-api/client-ip.ts';
import { installPublicApiPolicy, publicApiPath } from './public-api/middleware.ts';
import { queryValues } from './public-api/query.ts';
import { publicPost, publicRss } from './public-post.ts';
import { createApiKeyService } from './reader/api-keys.ts';
import { registerApiKeyRoutes } from './reader/key-routes.ts';
import { registerRelationRoutes } from './relations/routes.ts';
import { registerSearchRoutes } from './search.ts';
import { registerPageApi } from './seo/page-api.ts';
import { registerPageLinks } from './seo/page-links.ts';
import { createPublicPageRedirect } from './seo/redirects.ts';
import { registerSeoRoutes } from './seo/routes.ts';
import { registerTechRoutes } from './tech/routes.ts';
import { registerTopicRoutes } from './topics/routes.ts';
import { createUiProxy } from './ui-proxy.js';
import { registerApiStatus } from './v1/api-status.ts';
import { iconManifest, registerFavicons } from './v1/favicon-routes.ts';
import { iconUrl } from './v1/icons.ts';
import { buildOpenApi } from './v1/openapi.ts';
import { registerPublicApi } from './v1/routes.ts';
import { registerSimilarwebTraffic } from './v1/similarweb-routes.ts';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const sameOrigin = (request, origin) => !request.headers.origin || request.headers.origin === origin;

export async function buildApp(config, { logger = false, store = null } = {}) {
  const app = Fastify({
    logger: logger
      ? {
          ...(typeof logger === 'object' ? logger : {}),
          redact: ['req.headers.x-api-key', 'req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    exposeHeadRoutes: true,
  });
  installPrivateCachePolicy(app);
  app.setErrorHandler((error, request, reply) => {
    if (publicApiPath(request.url)) {
      const status = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503;
      return reply.code(status).send({
        error:
          status === 400
            ? 'invalid_query'
            : status === 404
              ? 'not_found'
              : status === 405
                ? 'method_not_allowed'
                : status === 410
                  ? 'gone'
                  : 'unavailable',
      });
    }
    return reply.send(error);
  });
  const own = store || createDb(config.blogDbUrl);
  const { pool } = own;
  registerPageLinks(app, pool);
  const startedAt = Date.now();
  const keys = createApiKeyService(pool);
  installPublicApiPolicy(app, keys);
  await app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    max: gatewayRateMax,
    allowList: (request) => publicApiPath(request.url),
    keyGenerator: gatewayRateKey,
  });
  registerPublicApi(app, pool);
  app.get('/api/v1/openapi.json', { config: { rateLimit: false } }, async (request) => {
    queryValues(request.query, []);
    return buildOpenApi();
  });
  registerFavicons(app);
  registerSimilarwebTraffic(app, pool);
  registerRelationRoutes(app, pool);
  registerAiRoutes(app, pool);
  registerTopicRoutes(app, pool);
  registerSearchRoutes(app, pool);
  registerSeoRoutes(app, pool);
  registerContentRoutes(app, pool);
  registerTechRoutes(app, pool, { enabled: config.techPublicEnabled === true, publicOrigin: config.publicOrigin });
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

  app.get('/api/catalog/authors', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      return await loadAuthorCatalog(pool, request.query);
    } catch (error) {
      reply.header('cache-control', 'no-store');
      if (error.code === 'INVALID_AUTHOR') return reply.code(400).send({ error: 'invalid author id' });
      return reply.code(503).send({ error: 'authors unavailable' });
    }
  });

  app.get('/api/catalog', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      return await loadCatalog(pool, request.query);
    } catch {
      return reply.header('cache-control', 'no-store').code(503).send({ error: 'catalog unavailable' });
    }
  });

  app.get('/api/overview', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (request.query?.view !== undefined && request.query.view !== 'home') return reply.code(400).send({ error: 'invalid_view' });
    try {
      return await loadOverview(pool, {
        home: request.query?.view === 'home',
        onFailure: (details) =>
          request.log.error(
            { operation: 'overview', view: request.query?.view === 'home' ? 'home' : 'full', ...details },
            'public overview read degraded',
          ),
      });
    } catch (error) {
      // Log only a bounded database error code, never SQL, text, credentials or headers.
      request.log.error(
        { operation: 'overview', view: request.query?.view === 'home' ? 'home' : 'full', ...overviewFailureDetails(error, pool) },
        'public overview read failed',
      );
      return reply.code(503).send({ error: 'unavailable' });
    }
  });

  app.get('/api/tags/:slug', async (request, reply) => {
    const [tags] = await pool.query("SELECT id,slug,label FROM tags WHERE slug=? AND visibility='public' AND status='active' LIMIT 1", [
      request.params.slug,
    ]);
    if (!tags.length) return reply.code(404).send({ error: 'tag not found' });
    const [posts] = await pool.query(
      `SELECT p.id,p.guid,p.title,p.url,p.summary,p.author,p.published_at AS publishedAt,p.image_url AS imageUrl,
      b.slug AS blogSlug,b.name AS blogName FROM posts p JOIN post_tags pt ON pt.post_id=p.id JOIN blogs b ON b.id=p.blog_id
      WHERE pt.tag_id=? AND pt.status='active' AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) ORDER BY p.published_at DESC,p.id DESC LIMIT 200`,
      [tags[0].id],
    );
    const [blogs] = await pool.query(
      `SELECT DISTINCT b.id,b.slug,b.name,b.url,b.category,b.status_label AS statusLabel
      FROM blogs b WHERE b.status='verified' AND (EXISTS (SELECT 1 FROM blog_tags bt WHERE bt.blog_id=b.id AND bt.tag_id=? AND bt.status='active') OR EXISTS (SELECT 1 FROM posts p JOIN post_tags pt ON pt.post_id=p.id WHERE p.blog_id=b.id AND pt.tag_id=? AND pt.status='active' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()))) ORDER BY b.name LIMIT 200`,
      [tags[0].id, tags[0].id],
    );
    const tagged = await withPostTags(pool, posts, {
      onFailure: () => request.log.warn({ operation: 'tag.postTags' }, 'post tags unavailable'),
    });
    return { tag: tags[0], posts: tagged.map(publicPost), blogs };
  });

  app.get('/api/blogs', async (request) => {
    const limit = Math.min(200, Math.max(1, Number(request.query?.limit || 200)));
    const [rows] = await pool.query(
      "SELECT id,slug,name,url,canonical_host AS canonicalHost,category,status,status_label AS statusLabel,description,last_crawled_at AS lastCrawledAt,last_crawl_success_at AS lastCrawlSuccessAt,last_published_at AS lastPublishedAt,expected_interval_hours AS expectedIntervalHours,stale_policy AS stalePolicy FROM blogs WHERE status='verified' ORDER BY name LIMIT ?",
      [limit],
    );
    const icons = await iconManifest();
    return { blogs: rows.map((blog) => ({ ...blog, iconUrl: iconUrl(blog.slug, icons) })) };
  });
  app.get('/api/blogs/:slug', async (request, reply) => {
    const [blogs] = await pool.query(
      "SELECT id,slug,name,url,canonical_host AS canonicalHost,category,status,status_label AS statusLabel,description,source_name AS sourceName,source_row AS sourceRow,last_crawled_at AS lastCrawledAt,last_crawl_success_at AS lastCrawlSuccessAt,last_published_at AS lastPublishedAt,expected_interval_hours AS expectedIntervalHours,stale_policy AS stalePolicy,history_imported_at AS historyImportedAt FROM blogs WHERE slug=? AND status='verified' LIMIT 1",
      [request.params.slug],
    );
    if (!blogs.length) return reply.code(404).send({ error: 'blog not found' });
    const [posts] = await pool.query(
      'SELECT id,guid,title,url,summary,author,published_at AS publishedAt,updated_at AS updatedAt,image_url AS imageUrl FROM posts WHERE blog_id=? AND (published_at IS NULL OR published_at<=UTC_TIMESTAMP()) ORDER BY COALESCE(published_at,updated_at,created_at) DESC LIMIT 50',
      [blogs[0].id],
    );
    const [authors] = await pool.query(
      `SELECT a.id,a.display_name AS displayName,a.bio,a.homepage_url AS homepageUrl,ba.role,ba.is_primary AS isPrimary
       FROM blog_authors ba JOIN authors a ON a.id=ba.author_id WHERE ba.blog_id=? AND ba.status <> 'rejected' ORDER BY ba.is_primary DESC,a.display_name`,
      [blogs[0].id],
    );
    const [tags] = await pool.query(
      `SELECT t.slug,t.label,t.kind,t.visibility,bt.role,
       (SELECT COUNT(DISTINCT p.id) FROM post_tags pt JOIN posts p ON p.id=pt.post_id WHERE pt.tag_id=t.id AND pt.status='active' AND p.blog_id=bt.blog_id AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())) AS postCount FROM blog_tags bt JOIN tags t ON t.id=bt.tag_id
       WHERE bt.blog_id=? AND bt.status='active' AND t.visibility='public' AND t.status='active' ORDER BY t.label`,
      [blogs[0].id],
    );
    // Every collected post (the page lists only the latest 50), with the same not-in-the-future rule.
    const [[total]] = await pool.query(
      'SELECT COUNT(*) AS n FROM posts WHERE blog_id=? AND (published_at IS NULL OR published_at<=UTC_TIMESTAMP())',
      [blogs[0].id],
    );
    // How often it actually posts: the median gap between its latest 21 published posts (a fixed default was shown).
    const [dates] = await pool.query(
      'SELECT published_at AS at FROM posts WHERE blog_id=? AND published_at IS NOT NULL AND published_at<=UTC_TIMESTAMP() ORDER BY published_at DESC LIMIT 21',
      [blogs[0].id],
    );
    const tagged = await withPostTags(pool, posts, {
      onFailure: () => request.log.warn({ operation: 'blog.postTags' }, 'post tags unavailable'),
    });
    return {
      blog: {
        ...blogs[0],
        genreState: await readBlogGenres(pool, [blogs[0].slug], () =>
          request.log.warn({ operation: 'blog.genres' }, 'blog genres unavailable'),
        ).then((result) => result.blogs.get(blogs[0].slug) ?? { status: 'unavailable', items: [] }),
        iconUrl: iconUrl(blogs[0].slug, await iconManifest()),
        authors,
        tags,
        postCount: Number(total.n),
        postingIntervalHours: postingIntervalHours(dates.map((row) => row.at)),
        crawlIntervalHours: crawlIntervalHours(),
      },
      posts: tagged.map(publicPost),
    };
  });

  const login = registerLogin(app, config.login ? dbLoginStore(own.db, { pool, adminEmails: config.adminEmails }) : null, config.login);
  registerApiKeyRoutes(app, { pool, login, keys, publicOrigin: config.publicOrigin, sessionSecret: config.login?.sessionSecret || '' });
  app.get('/api/me/capabilities', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const user = await login.currentUser(request);
    return { admin: Boolean(user && (await isAdmin(pool, user, config.adminEmails))) };
  });
  const requireUser = async (request, reply) => {
    const user = await login.currentUser(request);
    if (!user) {
      reply.code(401).send({ error: 'login required' });
      return null;
    }
    return user;
  };
  registerBlogGenreRoutes(app, {
    pool,
    requireUser,
    adminEmails: config.adminEmails,
    publicOrigin: config.publicOrigin,
    sessionSecret: config.login?.sessionSecret || '',
  });
  app.get('/api/me/follows', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const [follows] = await pool.query(
      "SELECT b.slug,b.name,b.url,b.category FROM user_follows f JOIN blogs b ON b.id=f.blog_id WHERE f.user_id=? AND b.status='verified' ORDER BY b.name",
      [user.id],
    );
    const icons = await iconManifest();
    return { follows: follows.map((blog) => ({ ...blog, iconUrl: iconUrl(blog.slug, icons) })) };
  });
  app.route({
    method: ['POST', 'DELETE'],
    url: '/api/blogs/:slug/follow',
    handler: async (request, reply) => {
      if (!sameOrigin(request, config.publicOrigin)) return reply.code(403).send({ error: 'same-origin requests only' });
      const user = await requireUser(request, reply);
      if (!user) return reply;
      const [blogs] = await pool.query(
        `SELECT id FROM blogs WHERE slug=? ${request.method === 'POST' ? "AND status='verified'" : ''} LIMIT 1`,
        [request.params.slug],
      );
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
    if (!user) return reply;
    const [items] = await pool.query(
      "SELECT p.guid,p.title,p.url,p.summary,p.published_at AS publishedAt FROM posts p JOIN blogs b ON b.id=p.blog_id JOIN user_follows f ON f.blog_id=p.blog_id WHERE f.user_id=? AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) ORDER BY COALESCE(p.published_at,p.updated_at,p.created_at) DESC LIMIT 100",
      [user.id],
    );
    return reply
      .type('application/rss+xml; charset=utf-8')
      .send(publicRss(items, '我的 blog.observe.tw 閱讀清單', `${config.publicOrigin}/me/feed.xml`));
  });
  app.get('/me/opml', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const [follows] = await pool.query(
      "SELECT b.name,b.url,(SELECT fs.url FROM feed_sources fs WHERE fs.blog_id=b.id AND fs.last_success_at IS NOT NULL AND fs.type IN ('rss','atom') ORDER BY fs.last_success_at DESC,fs.id LIMIT 1) AS feedUrl FROM user_follows f JOIN blogs b ON b.id=f.blog_id WHERE f.user_id=? AND b.status='verified' ORDER BY b.name",
      [user.id],
    );
    const outlines = follows
      .filter((item) => item.url && item.feedUrl)
      .map(
        (item) =>
          `<outline type="rss" text="${esc(item.name)}" title="${esc(item.name)}" htmlUrl="${esc(item.url)}" xmlUrl="${esc(item.feedUrl)}"/>`,
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
    if (!user) return reply;
    const xml = typeof request.body === 'string' ? request.body : '';
    if (xml.length > 1024 * 1024) return reply.code(413).send({ error: 'OPML too large' });
    const $ = cheerio.load(xml, { xmlMode: true });
    let followed = 0;
    let candidates = 0;
    const outlines = $('outline').toArray();
    if (outlines.length > 500) return reply.code(413).send({ error: 'OPML contains too many subscriptions (maximum 500)' });
    for (const element of outlines) {
      const rawUrl = $(element).attr('xmlUrl') || $(element).attr('htmlUrl');
      const url = rawUrl?.trim();
      if (url && url.length > 1024) continue;
      if (!url || !/^https?:\/\//i.test(url)) continue;
      const name = ($(element).attr('text') || $(element).attr('title') || '').slice(0, 255) || null;
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
          [url, name, 'opml-import', '/api/me/opml', JSON.stringify({ userId: user.id }), new Date()],
        );
        candidates += 1;
      }
    }
    return { followed, candidates };
  });

  registerAdminRoutes(app, {
    pool,
    login,
    publicOrigin: config.publicOrigin,
    sessionSecret: config.login?.sessionSecret || '',
    adminEmails: config.adminEmails ?? new Set(),
    similarEnabled: config.similarWeb?.enabled ?? false,
    userAgent: config.crawlUserAgent,
  });

  const proxyToUi = createUiProxy(config.uiOrigin);
  registerPageApi(app, pool);
  const redirectPublicPage = createPublicPageRedirect(pool, { legacyUiPaths: config.uiLegacyPagePaths === true });
  registerApiStatus(app, proxyToUi, pool);
  app.get('/api', proxyToUi);
  app.get('/api/', proxyToUi);
  const handler = async (request, reply) => {
    // Unknown API/auth routes must never cycle through Next's rewrites.
    if (/^\/(api|auth)(?:\/|$)/.test(request.url))
      return reply.code(404).send({ error: publicApiPath(request.url) ? 'not_found' : 'not found' });
    if (await redirectPublicPage(request, reply)) return reply;
    return proxyToUi(request, reply, redirectPublicPage.uiPath(request));
  };
  app.route({ method: ['GET', 'HEAD'], url: '/', handler });
  app.route({ method: ['GET', 'HEAD'], url: '/*', handler });
  app.addHook('onClose', async () => {
    if (!store) await own.close();
  });
  await app.ready();
  return app;
}
