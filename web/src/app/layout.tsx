import type { Metadata, Viewport } from 'next';
import SiteFooter from '@/components/site-footer';
import SiteHeader from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://blog.observe.tw'),
  title: { default: '部落格觀察', template: '%s · blog.observe.tw' },
  description: '找到值得持續閱讀的台灣部落格與獨立網站。',
  applicationName: 'blog.observe.tw',
  openGraph: { siteName: 'blog.observe.tw', locale: 'zh_TW' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

const themeScript = `(()=>{try{const m=matchMedia('(prefers-color-scheme: dark)');const s=localStorage.getItem('theme');document.documentElement.dataset.theme=s==='dark'||s==='light'?s:m.matches?'dark':'light'}catch{}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        {/* Static theme bootstrap follows the tag.observe.tw layout pattern. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="page-shell">
          <SiteHeader />
          <main className="shell page-main">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
