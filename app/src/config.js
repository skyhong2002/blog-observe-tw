import { loginConfig } from './auth/google-login.ts';

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 18160);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
  if (!env.BLOG_DB_URL) throw new Error('BLOG_DB_URL is required');
  const publicOrigin = new URL(env.BLOG_PUBLIC_ORIGIN || 'https://blog.observe.tw');
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
    blogDbUrl: env.BLOG_DB_URL,
    redisUrl,
    queueName,
    queuePrefix,
    logLevel: env.LOG_LEVEL || 'info',
    crawlUserAgent: env.BLOG_CRAWL_USER_AGENT || 'blog.observe.tw/0.3 (+https://blog.observe.tw/about; mailto:b@blog.observe.tw)',
    crawlDelayMs: Math.max(1000, Number(env.BLOG_CRAWL_DELAY_MS || 1200)),
    similarWeb: {
      // Explicit opt-in: tag and blog share a public IP and Similarweb rate
      // limits, so discovery must never silently start a second client.
      enabled: env.BLOG_SIMILARWEB_ENABLED === '1' || env.BLOG_SIMILARWEB_ENABLED === 'true',
      lockPath: env.BLOG_SIMILARWEB_LOCK_PATH || '/home/deck/.local/share/observe-similarweb-rate-limit.lock',
      budgetPath: env.BLOG_SIMILARWEB_BUDGET_PATH || '/home/deck/.local/share/observe-similarweb-rate-budget.json',
      maxPerDay: Math.max(1, Math.min(20, Number(env.BLOG_SIMILARWEB_MAX_PER_DAY || 10))),
    },
    login: loginConfig(env),
  };
}
