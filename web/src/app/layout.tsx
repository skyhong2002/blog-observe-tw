import type { Metadata, Viewport } from 'next';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import ThemeSync from '@/components/ThemeSync';
import TouchTitleHint from '@/components/TouchTitleHint';
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, SITE_TITLE } from '@/lib/seo';
import './globals.css';

// No canonical here: each public page sets its own (lib/seo.ts), so a page
// without one never inherits the home page's. The personal RSS feed is private
// and is not advertised as a public alternate.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, locale: 'zh_TW', images: ['/opengraph-image.png'] },
  twitter: { card: 'summary_large_image' },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: 'default' },
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
