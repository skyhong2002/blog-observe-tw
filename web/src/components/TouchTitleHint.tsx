'use client';

import { useEffect, useRef, useState } from 'react';

// Native `title` tooltips only appear on mouse hover. On touch, tapping an
// element that carries one shows its text in a small bubble instead; taps on
// links, buttons and form controls keep doing what they do. Mouse and keyboard
// behaviour is untouched.
const interactive = 'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]';

export default function TouchTitleHint() {
  const [hint, setHint] = useState<{ text: string; left: number; top: number; below: boolean } | null>(null);
  const source = useRef<Element | null>(null);
  const touch = useRef(false);
  useEffect(() => {
    const close = () => {
      source.current = null;
      setHint(null);
    };
    const down = (event: PointerEvent) => {
      touch.current = event.pointerType === 'touch';
    };
    const click = (event: MouseEvent) => {
      if (!touch.current || !(event.target instanceof Element)) return;
      const element = event.target.closest('[title]');
      const text = element?.getAttribute('title')?.trim();
      if (!element || !text || element === document.documentElement || element === document.body) return close();
      if (event.target.closest(interactive)) return close();
      if (source.current === element) return close();
      const box = element.getBoundingClientRect();
      const below = box.top < 80;
      source.current = element;
      setHint({
        text,
        left: Math.max(12, Math.min(box.left + box.width / 2, window.innerWidth - 12)),
        top: below ? box.bottom + 6 : box.top - 6,
        below,
      });
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('click', click);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('click', click);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, []);
  if (!hint) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed z-[110] w-max max-w-[min(20rem,calc(100vw-24px))] rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-line text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
      style={{
        left: hint.left,
        top: hint.top,
        // Centred on the element, then kept inside the viewport by the clamp below.
        transform: `translate(clamp(calc(12px - ${hint.left}px), -50%, calc(100vw - 12px - ${hint.left}px - 100%)), ${hint.below ? '0' : '-100%'})`,
      }}
    >
      {hint.text}
    </div>
  );
}
