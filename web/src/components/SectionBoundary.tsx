'use client';

// A section-sized error boundary: a read that throws inside it (a server component streamed in its own Suspense)
// replaces only that section, not the whole page (app/error.tsx). The fallback says the section failed and offers a
// retry that re-reads the page's server data (router.refresh), so a slow gateway answer can be tried again in place.
// `quiet` sections (decoration such as the masthead cloud) render nothing when they fail.

import { useRouter } from 'next/navigation';
import { Component, type ReactNode, startTransition } from 'react';

type Props = { label?: string; quiet?: boolean; className?: string; children: ReactNode };

class Boundary extends Component<Props & { retry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  // A refresh brings a new server payload as new children: try them, instead of keeping the old failure.
  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.children !== this.props.children) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    return <SectionUnavailable label={this.props.label} className={this.props.className} onRetry={this.props.retry} />;
  }
}

export default function SectionBoundary(props: Props) {
  const router = useRouter();
  return <Boundary {...props} retry={() => startTransition(() => router.refresh())} />;
}

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
