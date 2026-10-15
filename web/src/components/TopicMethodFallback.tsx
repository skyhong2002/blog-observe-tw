'use client';

import { usePathname } from 'next/navigation';
import FooterMethod, { OWN_METHOD } from './FooterMethod';

// For app/error.tsx and app/not-found.tsx: on topic paths the layout's footer omits the
// method block and the topic page that would render it never mounted, so render the
// generic block here. Nothing elsewhere — the layout's footer still covers those paths.
export default function TopicMethodFallback() {
  const pathname = usePathname();
  // Same place as the footer's copy elsewhere: main's bottom padding (24px) plus the footer's mt-14
  // (56px) sit above that one, so push this one down 80px. Below it, elsewhere the footer band's mt-10
  // follows (40px); here that mt-10 collapses into the then-empty footer's mt-14, so pull back only 40px.
  return OWN_METHOD.test(pathname) ? (
    <div className="mt-20 -mb-10">
      <FooterMethod page />
    </div>
  ) : null;
}
