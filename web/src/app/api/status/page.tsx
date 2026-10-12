// Adapted from tag.observe.tw afe0a65 (web/src/app/(site)/api/status/page.tsx), MIT, Copyright (c) 2026 Sky Hong.
// A static shell: the browser reads the gateway's JSON status itself, so the
// page never fetches its own URL (the gateway proxies HTML /api/status here).
import ApiStatusView from '@/components/ApiStatusView';
import ApiTabs from '@/components/ApiTabs';
import { staticPageMetadata } from '@/lib/seo';

export const dynamic = 'force-static';
export const metadata = staticPageMetadata('/api/status/');

export default function ApiStatusPage() {
  return (
    <div className="space-y-6">
      <ApiTabs current="status" />
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">API 狀態</h1>
        <p className="text-zinc-700 dark:text-zinc-300">查看部落格觀察公開 API 目前是否可用，以及各端點的用途。</p>
      </header>
      <ApiStatusView />
    </div>
  );
}
