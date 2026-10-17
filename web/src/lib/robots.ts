import { taipei } from './api';

/** The gateway's latest robots.txt read for a host (app/src/crawl/robots-observations.ts). */
export type RobotsStatus = {
  outcome: 'allowed' | 'missing' | 'partial' | 'blocked' | 'unreachable';
  httpStatus: number | null;
  error: 'timeout' | 'network' | 'invalid-response' | null;
  disallow: string[];
  checkedAt: string;
  readableAt: string | null;
};

/** A short label, a tone and a hover text naming the blocked paths and when the file was read. */
export function robotsLabel(robots: RobotsStatus | null | undefined): {
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'none';
  title: string;
} {
  if (!robots) return { label: '尚未讀取', tone: 'none', title: '還沒有讀過這個網站的 robots.txt' };
  const read = `讀取於 ${taipei(robots.checkedAt)}`;
  const paths = robots.disallow.slice(0, 12).join('、') + (robots.disallow.length > 12 ? ` 等 ${robots.disallow.length} 條` : '');
  switch (robots.outcome) {
    case 'allowed':
      return { label: '允許', tone: 'ok', title: `robots.txt 沒有限制本站爬蟲 · ${read}` };
    case 'missing':
      return robots.httpStatus === 404 || robots.httpStatus === 410
        ? { label: '無檔案', tone: 'ok', title: `網站沒有 robots.txt（HTTP ${robots.httpStatus}），視為允許 · ${read}` }
        : {
            label: `無規則（HTTP ${robots.httpStatus}）`,
            tone: 'ok',
            title: `robots.txt 回應 HTTP ${robots.httpStatus}，依 RFC 9309 視為沒有限制 · ${read}`,
          };
    case 'partial':
      return { label: '部分路徑限制', tone: 'ok', title: `禁止：${paths} · ${read}` };
    case 'blocked':
      return { label: '禁止', tone: 'bad', title: `robots.txt 禁止本站爬蟲讀取整個網站（${paths}）· ${read}` };
    default: {
      const why = robots.httpStatus
        ? `HTTP ${robots.httpStatus}`
        : robots.error === 'timeout'
          ? '連線逾時'
          : robots.error === 'invalid-response'
            ? '回應無效'
            : '連線失敗';
      const last = robots.readableAt ? `上次讀到是 ${taipei(robots.readableAt)}` : '從未成功讀到';
      return {
        label: `讀不到（${why}）`,
        tone: 'warn',
        title: `robots.txt 伺服器錯誤或連不上時視為禁止，暫停抓取 · ${last} · ${read}`,
      };
    }
  }
}
export const robotsTone = {
  ok: 'text-zinc-600 dark:text-zinc-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  none: 'text-zinc-400 dark:text-zinc-600',
} as const;
