import type { MetadataRoute } from 'next';

// Keep runtime route-cache writes outside immutable release artifacts; this tiny manifest is cheap to render.
export const dynamic = 'force-dynamic';

// Makes the site installable as a Web App (icons from tools/gen-pwa-icons.py).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: '部落格觀察：每一種生活，各自怎麼寫',
    short_name: '部落格觀察',
    description: '台灣部落格文章、作者、標籤與閱讀清單',
    lang: 'zh-Hant-TW',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#ffffff',
    categories: ['books', 'education'],
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: '最新文章', url: '/articles/' },
      { name: '部落格目錄', url: '/blogs/' },
      { name: '關鍵字排行', url: '/ranking/' },
      { name: '我的追蹤', url: '/my/' },
    ],
  };
}
