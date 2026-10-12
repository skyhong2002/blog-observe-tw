'use client';
// Ported from tag.observe.tw components/TrafficSparkline.tsx (afe0a65).

import { useEffect, useRef, useState } from 'react';
import { shortMonth, type TrafficPoint, trafficNumber } from '@/lib/traffic';

/** A few months of one blog as an SVG sparkline, oldest on the left; `ends`
 *  labels the first and last month underneath. A missing month is a gap, never
 *  a zero. A point's month and value appear on mouse hover or on tap. */
export default function TrafficSparkline({
  traffic,
  months,
  label: sourceLabel,
  ends = false,
}: {
  traffic: TrafficPoint[];
  months: string[];
  label: string;
  ends?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (active === null) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [active]);
  const values = months.map((month) => traffic.find((point) => point.month === month)?.visits ?? null);
  const known = values.filter((value): value is number => value !== null);
  if (known.length < 2) return null;
  const min = Math.min(...known);
  const span = Math.max(...known) - min || 1;
  const points = values.map((value, index) =>
    value === null ? null : [4 + (index * 56) / Math.max(1, values.length - 1), 20 - ((value - min) / span) * 16],
  );
  let path = '';
  let gap = true;
  for (const point of points) {
    if (!point) {
      gap = true;
      continue;
    }
    path += `${gap ? 'M' : 'L'}${point[0]},${point[1]} `;
    gap = false;
  }
  const text = (index: number) => `${shortMonth(months[index])}：${values[index] === null ? '無資料' : trafficNumber(values[index])}`;
  const label = months.map((_, index) => text(index)).join('；');
  const monthTick = (month: string) => `${Number(month.slice(4))}月`;
  return (
    <span ref={root} className="relative inline-flex w-16 shrink-0 flex-col">
      <svg
        viewBox="0 0 64 24"
        className="h-6 w-16 overflow-visible text-brand-600 dark:text-brand-400"
        role="img"
        aria-label={`${sourceLabel}：${label}`}
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
        {points.map(
          (point, index) =>
            point && (
              // biome-ignore lint/a11y/noStaticElementInteractions: The svg's aria-label already reads every month; points only add a pointer tooltip.
              <g
                key={months[index]}
                onPointerEnter={(event) => event.pointerType === 'mouse' && setActive(index)}
                onPointerLeave={(event) => event.pointerType === 'mouse' && setActive(null)}
                onClick={() => setActive(index)}
                className="cursor-pointer"
              >
                <circle cx={point[0]} cy={point[1]} r="8" fill="transparent" />
                <circle cx={point[0]} cy={point[1]} r={active === index ? 2.75 : 1.75} fill="currentColor" />
              </g>
            ),
        )}
      </svg>
      {ends && (
        <span aria-hidden="true" className="flex justify-between text-[9px] leading-3 text-zinc-500 dark:text-zinc-400">
          <span>{monthTick(months[0])}</span>
          <span>{monthTick(months.at(-1) as string)}</span>
        </span>
      )}
      {active !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-full z-20 mr-1.5 -translate-y-1/2 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] text-white shadow dark:bg-zinc-100 dark:text-zinc-900"
        >
          {text(active)}
        </span>
      )}
    </span>
  );
}
