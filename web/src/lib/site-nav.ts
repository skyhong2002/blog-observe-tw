// Adapted from tag.observe.tw afe0a65: same grouped navigation, blog entities.
export type NavLink = { href: string; label: string; short: string };
export const NAV_GROUPS: Array<{ label: string; links: NavLink[] }> = [
  {
    label: '看文章',
    links: [
      { href: '/articles/', label: '最新文章', short: '文章' },
      { href: '/tags/', label: '文章標籤', short: '標籤' },
    ],
  },
  { label: '看趨勢', links: [{ href: '/ranking/', label: '大家正在寫什麼', short: '關鍵字' }] },
  {
    label: '看部落格',
    links: [
      { href: '/blogs/', label: '部落格目錄', short: '部落格' },
      { href: '/authors/', label: '文章作者', short: '作者' },
      { href: '/traffic/', label: '部落格流量', short: '流量' },
    ],
  },
  {
    label: '我的',
    links: [
      { href: '/my/', label: '我的追蹤', short: '追蹤' },
      { href: '/me/feed.xml', label: '個人 RSS', short: 'RSS' },
    ],
  },
];
export const METHOD_HREF = '/about/';
