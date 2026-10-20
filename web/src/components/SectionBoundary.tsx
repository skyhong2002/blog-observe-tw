'use client';

// A section-sized error boundary (next/error catchError): a read that throws inside it (a server component streamed
// in its own Suspense) replaces only that section, not the whole page (app/error.tsx). The fallback says the section
// failed and offers retry(), which re-fetches and re-renders just this boundary's children, so a slow gateway answer
// can be tried again in place. `quiet` sections (decoration such as the masthead cloud) render nothing when they fail.

import { catchError, type ErrorInfo } from 'next/error';

type Props = { label?: string; quiet?: boolean; className?: string };

function SectionFallback({ label, quiet, className }: Props, { retry }: ErrorInfo) {
  return quiet ? null : <SectionUnavailable label={label} className={className} onRetry={() => retry()} />;
}

export default catchError(SectionFallback);

/** 「…暫時無法載入，請稍後再試。」 with a retry; the same words a failed section uses everywhere. */
export function SectionUnavailable({ label, className, onRetry }: { label?: string; className?: string; onRetry?: () => void }) {
  return (
    <div
      role="status"
      className={
        className ??
        'rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'
      }
    >
      <p>{label ? `${label}暫時無法載入，請稍後再試。` : '暫時無法載入，請稍後再試。'}</p>
      <button
        type="button"
        onClick={onRetry ?? (() => window.location.reload())}
        className="mt-1.5 text-brand-700 hover:underline dark:text-brand-400"
      >
        重新載入
      </button>
    </div>
  );
}
