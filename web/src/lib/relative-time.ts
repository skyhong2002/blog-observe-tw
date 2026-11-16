/** Short elapsed time; fixed units keep Node and browser output identical. */
export function relativeTime(value: string, now: number): string | null {
  const at = Date.parse(value);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return null;
  const seconds = Math.abs(now - at) / 1000;
  if (seconds < 60) return at > now ? '即將' : '剛剛';
  const units = [
    [365 * 86400, '年'],
    [30 * 86400, '個月'],
    [86400, '天'],
    [3600, '小時'],
    [60, '分鐘'],
  ] as const;
  const [size, label] = units.find(([size]) => seconds >= size)!;
  return `${Math.floor(seconds / size)} ${label}${at > now ? '後' : '前'}`;
}
