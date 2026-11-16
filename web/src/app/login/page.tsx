import { Suspense } from 'react';
import Link from '@/components/NoPrefetchLink';
import { privatePageMetadata } from '@/lib/seo';
import LoginError from './LoginError';

// A static page: the gateway's ?error= after a failed Google sign-in is read in the browser.
export const dynamic = 'force-static';
export const metadata = privatePageMetadata('登入');

export default function LoginPage() {
  return (
    // One centred card: the page has a single task, so it sits in the middle rather than on a column edge.
    <section className="mx-auto my-6 max-w-md space-y-5 rounded-2xl border border-zinc-300 bg-white p-6 sm:my-10 sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-2xl font-semibold">登入部落格觀察</h1>
      <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">保存追蹤清單，匯出個人 RSS 與 OPML。</p>
      <Suspense fallback={null}>
        <LoginError />
      </Suspense>
      <a
        href="/auth/google?next=%2Fmy%2F"
        className="flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        使用 Google 登入
      </a>
      <p>
        <Link href="/about/" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          了解帳號與資料使用方式
        </Link>
      </p>
    </section>
  );
}
