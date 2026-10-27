import { loginConfig } from './auth/google-login.ts';

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 18160);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
  if (!env.BLOG_DB_URL) throw new Error('BLOG_DB_URL is required');
  const publicOrigin = new URL(env.BLOG_PUBLIC_ORIGIN || 'https://weblog.tw');
  if (!['http:', 'https:'].includes(publicOrigin.protocol)) throw new Error('BLOG_PUBLIC_ORIGIN must be http(s)');
  const uiOrigin = new URL(env.BLOG_UI_ORIGIN || 'http://127.0.0.1:18162');
  if (!['http:', 'https:'].includes(uiOrigin.protocol)) throw new Error('BLOG_UI_ORIGIN must be http(s)');
  const redisUrl = env.BLOG_REDIS_URL || 'redis://127.0.0.1:17379';
  const queueName = env.BLOG_QUEUE_NAME || 'blog-observe-crawl';
  const queuePrefix = env.BLOG_QUEUE_PREFIX || 'blog-observe';
  if (queueName === 'tag-jobs' || queuePrefix === 'tag') throw new Error('blog queue must remain isolated from tag');
  return {
    host: env.HOSTNAME || '127.0.0.1',
    port,
    publicOrigin: publicOrigin.origin,
    uiOrigin: uiOrigin.origin,
    uiLegacyPagePaths: env.BLOG_UI_LEGACY_PAGE_PATHS === 'true',
    blogDbUrl: env.BLOG_DB_URL,
    redisUrl,
    queueName,
    queuePrefix,
    // Collection and publication are separate switches: candidate review must
    // complete before passive technology observations become public.
    techPublicEnabled: env.BLOG_TECH_PUBLIC_ENABLED === 'true',
    logLevel: env.LOG_LEVEL || 'info',
    crawlUserAgent: env.BLOG_CRAWL_USER_AGENT || 'weblog.tw/0.3 (+https://weblog.tw/about; mailto:b@blog.observe.tw)',
    crawlDelayMs: Math.max(1000, Number(env.BLOG_CRAWL_DELAY_MS || 1200)),
    similarWeb: {
      // Only the fixed loopback tag API may contact the provider.
      enabled: env.BLOG_SIMILARWEB_ENABLED === 'true',
    },
    adminEmails: new Set(
      (env.BLOG_ADMIN_EMAILS || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
    login: loginConfig(env),
  };
}
