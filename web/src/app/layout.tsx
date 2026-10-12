import type { Metadata, Viewport } from 'next';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import ThemeSync from '@/components/ThemeSync';
import TouchTitleHint from '@/components/TouchTitleHint';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://blog.observe.tw'),
  title: { default: '部落格觀察：每一種生活，各自怎麼寫', template: '%s · 部落格觀察' },
  description: '每一種生活，各自怎麼寫。台灣部落格文章、作者與標籤，持續閱讀不同的生活',
  applicationName: '部落格觀察',
  openGraph: { siteName: '部落格觀察', locale: 'zh_TW', images: ['/opengraph-image.png'] },
  twitter: { card: 'summary_large_image' },
  appleWebApp: { capable: true, title: '部落格觀察', statusBarStyle: 'default' },
  alternates: { types: { 'application/rss+xml': [{ url: '/me/feed.xml', title: '部落格觀察｜個人閱讀' }] } },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

// Runs before first paint: a saved choice wins, otherwise follow the system and keep following it.
// Also keeps Chrome's install prompt (it can fire before hydration) for the footer's 安裝 Web App.
const themeScript = `addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__installPrompt=e});(function(){try{var m=matchMedia('(prefers-color-scheme: dark)');function a(){var s=localStorage.getItem('theme');document.documentElement.dataset.theme=s==='dark'||s==='light'?s:m.matches?'dark':'light'}a();m.addEventListener('change',a)}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className="h-full" suppressHydrationWarning>
      <head>
        {/* Static upstream theme bootstrap; no user input. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <ThemeSync />
        <a
          href="#blog-main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-zinc-900 focus:shadow"
        >
          跳至文章內容
        </a>
        <SiteHeader />
        <main id="blog-main" className="mx-auto max-w-6xl px-4 py-6">
          {children}
        </main>
        <div className="mx-auto max-w-6xl px-4">
          <SiteFooter />
        </div>
        <TouchTitleHint />
      </body>
    </html>
  );
}
