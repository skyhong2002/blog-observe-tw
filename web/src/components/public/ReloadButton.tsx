'use client';

/** Retry for a query view whose same-origin read failed: reloads the current URL. */
export default function ReloadButton({ label = '重新載入' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-3 inline-block text-brand-700 hover:underline dark:text-brand-400"
    >
      {label}
    </button>
  );
}
