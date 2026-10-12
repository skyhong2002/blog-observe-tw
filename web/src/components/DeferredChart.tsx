'use client';
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';

/** Reserve the final size; load the chart runtime only near the viewport. */
export default function DeferredChart({ children, className, label }: { children: ReactNode; className: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} role="img" aria-label={label} aria-busy={!visible}>
      {visible && <Suspense fallback={null}>{children}</Suspense>}
    </div>
  );
}
