import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        <div>
          <p className="footer-title">blog.observe.tw</p>
          <p>透明地觀察部落格更新，連回作者自己的網站閱讀。</p>
        </div>
        <nav aria-label="頁尾導覽" className="footer-links">
          <Link href="/blogs/">部落格目錄</Link>
          <Link href="/my/">我的閱讀</Link>
          <a href="/me/feed.xml">個人 RSS</a>
          <a href="/me/opml">OPML 匯出</a>
          <Link href="/about/">關於與資料來源</Link>
        </nav>
        <p className="copyright">© 2026 blog.observe.tw · MIT License</p>
      </div>
    </footer>
  );
}
