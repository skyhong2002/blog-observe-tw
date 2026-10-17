// After tag.observe.tw fcb39ede: every /admin/ page carries the same second-level tabs.
import SectionTabs from '../SectionTabs';

export const ADMIN_SECTIONS = {
  discovery: { href: '/admin/', label: '候選來源', intro: '新發現的部落格網址：先驗證，再核准收錄或拒絕。' },
  blogs: {
    href: '/admin/blogs/',
    label: '部落格',
    intro: '所有部落格的類型、收錄狀態與修改次數；點名稱可設定這個部落格的簡介與標籤。',
  },
  overrides: { href: '/admin/overrides/', label: '簡介與標籤', intro: '修正一個部落格在站上的簡介、標籤與文章主題。' },
  accounts: { href: '/admin/accounts/', label: '帳號', intro: '登入過的帳號，以及各自在站上的互動與貢獻。' },
  audits: { href: '/admin/audits/', label: '稽核紀錄', intro: '每一筆管理修改的紀錄，含操作人、對象與原因。' },
} as const;
export type AdminSection = keyof typeof ADMIN_SECTIONS;

export default function AdminTabs({ current }: { current: AdminSection }) {
  return (
    <SectionTabs
      label="管理後台"
      className="flex-wrap"
      tabs={Object.entries(ADMIN_SECTIONS).map(([key, { href, label }]) => ({ href, label, current: key === current }))}
    />
  );
}
