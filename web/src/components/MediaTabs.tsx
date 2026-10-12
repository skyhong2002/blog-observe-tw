import SectionTabs from './SectionTabs';
export default function MediaTabs({ current }: { current: 'media' | 'traffic' }) {
  return (
    <SectionTabs
      label="部落格資料"
      className="mb-5"
      tabs={[
        { key: 'media', href: '/blogs/', label: '收錄概況' },
        { key: 'traffic', href: '/traffic/', label: '流量與排名' },
      ].map((tab) => ({ ...tab, current: current === tab.key }))}
    />
  );
}
