import type { NextConfig } from 'next';

const gateway = process.env.BLOG_GATEWAY_INTERNAL_URL ?? 'http://127.0.0.1:18160';
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  trailingSlash: true,
  // Keep the health probe usable at the conventional `/healthz` URL while
  // content links continue to use trailing slashes like tag.observe.tw.
  skipTrailingSlashRedirect: true,
  // ISR pages revalidate every 120 s; cap how long a stale page may be served
  // so Cache-Control becomes `s-maxage=120, stale-while-revalidate=180`
  // instead of Next's one-year default.
  expireTime: 300,
  allowedDevOrigins: process.env.BLOG_DEV_ORIGINS?.split(',').filter(Boolean),
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }, { protocol: 'http', hostname: '**' }] },
  async rewrites() {
    return [
      // The gateway owns sessions and API credentials. The internal origin is
      // read at build/start time only and is never sent to the browser.
      { source: '/api/:path*', destination: `${gateway}/api/:path*` },
      { source: '/auth/:path*', destination: `${gateway}/auth/:path*` },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
