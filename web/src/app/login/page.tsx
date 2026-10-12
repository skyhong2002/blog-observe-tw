import { Suspense } from 'react';
import Link from '@/components/NoPrefetchLink';
import { privatePageMetadata } from '@/lib/seo';
import LoginError from './LoginError';

// A static page: the gateway's ?error= after a failed Google sign-in is read in the browser.
export const dynamic = 'force-static';
export const metadata = privatePageMetadata('登入');

export default function LoginPage() {
  return (
    <section className="mx-auto max-w-xl space-y-5 py-8">
      <h1 className="text-2xl font-semibold">登入部落格觀察</h1>
      <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">保存追蹤清單，匯出個人 RSS 與 OPML。</p>
      <Suspense fallback={null}>
        <LoginError />
      </Suspense>
      <a href="/auth/google?next=%2Fmy%2F" className="inline-flex min-h-10 items-center rounded-lg bg-brand-700 px-4 text-sm text-white">
        使用 Google 登入
      </a>
      <p>
        <Link href="/about/" className="text-sm text-zinc-500 hover:underline">
          了解帳號與資料使用方式
        </Link>
      </p>
    </section>
  );
}
