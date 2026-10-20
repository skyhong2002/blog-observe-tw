// Adapted from tag.observe.tw afe0a65: same grouped navigation, blog entities.
/** `feature` links show only when the server turns that feature on (navGroupsFor). */
export type NavLink = { href: string; label: string; short: string; feature?: 'tech' };
export const NAV_GROUPS: Array<{ label: string; links: NavLink[] }> = [
  {
    label: '看文章',
    links: [
      { href: '/articles/', label: '最新文章', short: '文章' },
      { href: '/tags/', label: '文章標籤', short: '標籤' },
    ],
  },
  { label: '看關係', links: [{ href: '/relations/', label: '部落格關係圖', short: '關係圖' }] },
  { label: '看話題', links: [{ href: '/topics/', label: '大家正在寫什麼', short: '話題' }] },
  {
    label: '看部落格',
    links: [
      { href: '/blogs/', label: '部落格目錄', short: '部落格' },
      { href: '/traffic/', label: '部落格流量', short: '流量' },
      { href: '/tech/', label: '使用的技術', short: '技術', feature: 'tech' },
    ],
  },
  {
    label: '我的',
    links: [
      // 個人 RSS needs a signed-in browser: it is on /my/ and in the account menu, not a bare header link.
      { href: '/my/', label: '我的追蹤', short: '追蹤' },
      { href: '/api/', label: 'API 文件', short: 'API' },
    ],
  },
];
export const METHOD_HREF = '/about/';

/** NAV_GROUPS without the links of features the server has not turned on (all off unless asked for). */
export function navGroupsFor(features: { tech?: boolean } = {}) {
  return NAV_GROUPS.map((group) => ({ ...group, links: group.links.filter((link) => !link.feature || features[link.feature] === true) }));
}
