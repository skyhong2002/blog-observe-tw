'use client';

import Link from './NoPrefetchLink';

// The header's pointer to the page's 本頁的資料來源與計算方式 (FooterMethod, #method): the
// explanations live there, not under the title. A client-side hash jump fires no hashchange,
// so the click opens the closed block itself; FooterMethod opens it on a loaded #method URL.
export default function MethodLink({ label = '資料來源與計算方式' }: { label?: string }) {
  return (
    <Link
      href="#method"
      scroll={false}
      onClick={() => {
        const block = document.getElementById('method')?.closest('details');
        if (block) block.open = true;
        document.getElementById('method')?.scrollIntoView();
      }}
      className="hover:text-brand-700 hover:underline dark:hover:text-brand-400"
    >
      {label} ⓘ
    </Link>
  );
}
