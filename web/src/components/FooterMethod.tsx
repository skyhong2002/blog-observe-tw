'use client';

import { usePathname } from 'next/navigation';
import { METHOD_HREF } from '@/lib/site-nav';
import Link from './NoPrefetchLink';

const inlineLink = 'text-brand-700 underline underline-offset-2 dark:text-brand-400';

// Which method blocks explain which pages; anything unlisted gets 資料來源.
function sectionsFor(_pathname: string) {
  return (
    <>
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">資料來源</h3>
      <p>
        從部落格公開的 RSS、Atom 與 sitemap 收錄文章標題、摘要及原文連結，保留來源與發現路徑。部落格更新頻率不同，不以最近發文日期判定失效。
      </p>
      <p>標籤保留原站、社群與人工整理的來源；同名作者不會自動跨站合併。候選站經確認後才納入追蹤。</p>
    </>
  );
}

// Topic pages render this block themselves, after their content, with the payload's
// vocabulary and coverage notes (components/public/TopicMethod.tsx); the layout's
// footer leaves it out there so a page never has two. When the topic page never
// mounts (app/error.tsx, app/not-found.tsx), TopicMethodFallback renders it instead.
export const OWN_METHOD = /^\/topics(\/|$)/;

// The footer's collapsible 資料來源與計算方式: the blocks for this page, the page's
// own notes, then a link to the full write-up. Hidden on that page itself.
// `page` marks the copy a page renders itself (see OWN_METHOD).
export default function FooterMethod({ notes, page = false }: { notes?: React.ReactNode; page?: boolean }) {
  const pathname = usePathname();
  if (pathname === METHOD_HREF || `${pathname}/` === METHOD_HREF) return null;
  if (!page && OWN_METHOD.test(pathname)) return null;
  return (
    <details className="group border-t border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:text-brand-700 dark:hover:text-brand-400 [&::-webkit-details-marker]:hidden">
        <span>
          本頁的資料來源與計算方式
          <span className="ml-1 text-xs font-normal text-brand-700 dark:text-brand-400" aria-hidden="true">
            ⓘ
          </span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          className="shrink-0 transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      {/* The anchor sits inside <details> so /#method opens it (browsers reveal fragment targets). */}
      <div id="method" className="max-w-3xl scroll-mt-32 space-y-2.5 pb-5 text-[13px] leading-[1.9]">
        {sectionsFor(pathname)}
        {notes}
        <p>
          <Link href={METHOD_HREF} className={inlineLink}>
            完整的資料來源與計算方式 →
          </Link>
        </p>
      </div>
    </details>
  );
}
