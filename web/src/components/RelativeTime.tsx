'use client';

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { taipei } from '@/lib/api';
import { relativeTime } from '@/lib/relative-time';

const Clock = createContext<number | null>(null);

/** The server's clock is serialized once, so the first browser render matches SSR even at minute boundaries. */
export function RelativeTimeProvider({ initialNow, children }: { initialNow: number; children: ReactNode }) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return <Clock.Provider value={now}>{children}</Clock.Provider>;
}

export default function RelativeTime({ value }: { value?: string | null }) {
  const now = useContext(Clock);
  if (!value || !Number.isFinite(Date.parse(value))) return <>尚無紀錄</>;
  const full = taipei(value);
  return (
    <time dateTime={value} title={`${full}（台北時間）`} className="whitespace-nowrap">
      {now === null ? full : relativeTime(value, now)}
    </time>
  );
}
