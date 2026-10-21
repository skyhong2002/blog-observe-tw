import SectionTabs from './SectionTabs';

/** 看關係: the citation feed and the relation map are two views of the same body links. */
export default function RelationTabs({ current }: { current: 'mentions' | 'relations' }) {
  return (
    <SectionTabs
      label="部落格關係"
      className="mb-5"
      tabs={[
        { key: 'mentions', href: '/mentions/', label: '最近引用' },
        { key: 'relations', href: '/relations/', label: '關係圖' },
      ].map((tab) => ({ ...tab, current: current === tab.key }))}
    />
  );
}
