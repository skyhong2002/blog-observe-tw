'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from './theme-toggle';

const links = [
  { href: '/blogs/', label: '部落格目錄' },
  { href: '/blogs/?sort=recent', label: '最新收錄' },
  { href: '/my/', label: '我的閱讀' },
];

export default function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="shell nav-row">
        <Link href="/" className="wordmark" aria-label="blog.observe.tw 首頁">
          <span className="wordmark-mark">BO</span>
          <span>blog.observe.tw</span>
        </Link>
        <nav className="nav-links" aria-label="主要導覽">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={pathname.startsWith('/' + link.href.split('/')[1]) ? 'active' : ''}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="nav-actions">
          <ThemeToggle />
          <a className="login-link" href={`/auth/google?next=${encodeURIComponent(pathname || '/')}`}>
            登入
          </a>
        </div>
      </div>
    </header>
  );
}
