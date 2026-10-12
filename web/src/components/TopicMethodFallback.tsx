'use client';

import { usePathname } from 'next/navigation';
import FooterMethod, { OWN_METHOD } from './FooterMethod';

// For app/error.tsx and app/not-found.tsx: on topic paths the layout's footer omits the
// method block and the topic page that would render it never mounted, so render the
// generic block here. Nothing elsewhere — the layout's footer still covers those paths.
export default function TopicMethodFallback() {
  const pathname = usePathname();
  return OWN_METHOD.test(pathname) ? <FooterMethod page /> : null;
}
