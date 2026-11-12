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
        'flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[0.9375rem] text-red-900 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-100'
      }
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-1 shrink-0 text-red-600 dark:text-red-300"
      >
        <path d="M12 3 2.5 20h19L12 3Z" />
        <path d="M12 10v4.5M12 17.5h.01" />
      </svg>
      <div className="min-w-0">
        <p>{label ? `${label}暫時無法載入，請稍後再試。` : '暫時無法載入，請稍後再試。'}</p>
        <button
          type="button"
          onClick={onRetry ?? (() => window.location.reload())}
          className="mt-1.5 inline-flex min-h-9 items-center rounded-full border border-red-300 bg-white px-3 text-sm font-medium text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-100 dark:hover:bg-red-900"
        >
          重新載入
        </button>
      </div>
    </div>
  );
}
