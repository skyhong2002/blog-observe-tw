// Adapted from tag.observe.tw afe0a65 (web/src/components/ApiTabs.tsx), MIT, Copyright (c) 2026 Sky Hong.
import SectionTabs from './SectionTabs';

export default function ApiTabs({ current }: { current: 'docs' | 'status' }) {
  return (
    <SectionTabs
      label="API 文件與狀態"
      tabs={[
        { href: '/api/', label: 'API 文件', current: current === 'docs' },
        { href: '/api/status/', label: 'API 狀態', current: current === 'status' },
      ]}
    />
  );
}
