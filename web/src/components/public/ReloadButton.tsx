'use client';

import { stateActionClass } from '@/components/StateNotice';

/** Retry for a query view whose same-origin read failed: reloads the current URL. */
export default function ReloadButton({ label = '重新載入', primary = true }: { label?: string; primary?: boolean }) {
  return (
    <button type="button" onClick={() => window.location.reload()} className={`mt-1 ${stateActionClass(primary)}`}>
      {label}
    </button>
  );
}
