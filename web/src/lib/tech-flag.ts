import 'server-only';

/**
 * Whether the public 使用的技術 pages are shown: /tech/, its nav link and the
 * blog profile section. Off unless the server's runtime env says exactly
 * 'true'; there is no NEXT_PUBLIC_ build flag, so client code only ever sees
 * the boolean the layout passes down. The gateway's own switch for the same
 * routes is separate (app/src/config.js); app/tech/page.tsx handles the two
 * disagreeing.
 */
export const techPublicEnabled = () => process.env.BLOG_TECH_PUBLIC_ENABLED === 'true';
