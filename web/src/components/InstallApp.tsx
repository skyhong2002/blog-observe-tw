'use client';

import { useEffect, useRef, useState } from 'react';

// 安裝 Web App: uses the browser's install prompt where there is one (Chrome,
// Edge, Android; captured early by the root layout's inline script), otherwise
// shows the steps for the visitor's browser (Safari has no prompt API).

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
declare global {
  interface Window {
    __installPrompt?: InstallPrompt | null;
  }
}

type Platform = 'ios' | 'mac-safari' | 'android' | 'firefox' | 'desktop';
function detect(): Platform {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'mac-safari';
  return 'desktop';
}

const STEPS: Record<Platform, { title: string; steps: string[] }> = {
  ios: {
    title: 'iPhone／iPad',
    steps: ['用 Safari 開啟 weblog.tw', '點畫面下方（iPad 在右上）的「分享」按鈕', '選「加入主畫面」，再點「新增」'],
  },
  'mac-safari': { title: 'Mac 上的 Safari', steps: ['點選單列的「檔案」', '選「加入 Dock」，再點「加入」'] },
  android: {
    title: 'Android',
    steps: ['點瀏覽器右上角的「⋮」選單', '選「安裝應用程式」或「加到主畫面」', '依提示完成'],
  },
  firefox: {
    title: 'Firefox',
    steps: ['電腦版 Firefox 不支援安裝 Web App', '請改用 Chrome、Edge 或 Safari 開啟本站，再點一次「安裝 Web App」'],
  },
  desktop: {
    title: 'Chrome／Edge',
    steps: ['點網址列右側的「安裝」圖示', '或從瀏覽器選單選「投放、儲存與分享」→「安裝網頁…」（Edge：「應用程式」→「安裝此網站」）'],
  },
};

export default function InstallApp({ className, children = '安裝 Web App' }: { className?: string; children?: React.ReactNode }) {
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>('desktop');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setPlatform(detect());
    const standalone =
      matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const keep = (e: Event) => {
      e.preventDefault();
      window.__installPrompt = e as InstallPrompt;
    };
    const done = () => {
      window.__installPrompt = null;
      setInstalled(true);
    };
    addEventListener('beforeinstallprompt', keep);
    addEventListener('appinstalled', done);
    return () => {
      removeEventListener('beforeinstallprompt', keep);
      removeEventListener('appinstalled', done);
    };
  }, []);

  async function install() {
    const prompt = window.__installPrompt;
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      window.__installPrompt = null;
      if (outcome === 'accepted') setInstalled(true);
      return;
    }
    dialog.current?.showModal();
  }

  if (installed) return <span className={className}>已安裝 Web App</span>;
  const help = STEPS[platform];
  return (
    <>
      <button type="button" onClick={install} className={`cursor-pointer text-left ${className ?? ''}`}>
        {children}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="install-app-title"
        className="m-auto w-[min(92vw,26rem)] rounded-xl border border-zinc-300 bg-white p-5 text-sm text-zinc-800 shadow-xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.close()}
      >
        <h2 id="install-app-title" className="text-base font-semibold">
          把部落格觀察裝到{help.title}
        </h2>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">安裝後會出現在主畫面或應用程式清單，像 App 一樣開啟，不必下載商店 App。</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5">
          {help.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <form method="dialog" className="mt-4 text-right">
          <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900">
            知道了
          </button>
        </form>
      </dialog>
    </>
  );
}
