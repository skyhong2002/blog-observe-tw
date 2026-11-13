import SectionTabs from './SectionTabs';

/** 看關係: the citation feed and the relation map are two views of the same body links. */
export default function RelationTabs({ current, className = 'mb-5' }: { current: 'mentions' | 'relations'; className?: string }) {
  return (
    <SectionTabs
      label="部落格關係"
      className={className}
      tabs={[
        { key: 'mentions', href: '/mentions/', label: '最近引用' },
        { key: 'relations', href: '/relations/', label: '引用關係圖' },
      ].map((tab) => ({ ...tab, current: current === tab.key }))}
    />
  );
}
