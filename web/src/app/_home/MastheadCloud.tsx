import Link from 'next/link';

import Logo from '@/components/Logo';
import WordCloud from '@/components/WordCloud';
import type { Overview } from '@/lib/api';

import styles from './home.module.css';

// The ranking page's 正在發酵 cloud for all outlets without a media gate.
const HOME_CLOUD_HREF = '/ranking/';

// The masthead (mark, tagline, edition line and the link to the ranking) sits
// in the middle of one of three canvases, picked by viewport width in
// home.module.css. The cloud's SVG scales with the frame, and so does the
// masthead: its sizes are canvas units times --u (frame width ÷ canvas width),
// so the two never drift apart. Each frame's max-width keeps the scale near 1,
// so a canvas is never blown up past ~1.2× on a wider screen.
interface Canvas {
  key: 'compact' | 'medium' | 'wide';
  width: number;
  height: number;
  /** Widest the frame may grow, in CSS px. */
  max: number;
  /** Mark size, tagline and small-line font sizes, in canvas units. */
  logo: number;
  tagline: number;
  small: number;
  sizes: { min: number; max: number; floor: number; budget: number; gap: number; markGap: number; scatter: number };
}
const CANVASES: Canvas[] = [
  {
    key: 'compact',
    width: 340,
    height: 300,
    max: 420,
    logo: 100,
    tagline: 14,
    small: 12,
    sizes: { min: 10, max: 27, floor: 9, budget: 0.9, gap: 7, markGap: 12, scatter: 900 },
  },
  {
    key: 'medium',
    width: 680,
    height: 280,
    max: 780,
    logo: 120,
    tagline: 14,
    small: 12,
    sizes: { min: 11, max: 36, floor: 10, budget: 0.85, gap: 10, markGap: 18, scatter: 1400 },
  },
  {
    key: 'wide',
    width: 1120,
    height: 280,
    max: 1120,
    logo: 128,
    tagline: 14,
    small: 12,
    sizes: { min: 12, max: 44, floor: 11, budget: 0.8, gap: 14, markGap: 26, scatter: 2000 },
  },
];

/** The boxes the cloud keeps clear, matching the masthead's CSS: the mark (by
 *  its glyphs), a 3% gap, the tagline (line-height 1.6), 2 units, then the
 *  edition line and the link (line-height 1.7 each). Widths allow for the text
 *  plus a little slack. */
function stack({ logo, tagline: t, small: e }: Canvas) {
  const gap = logo * 0.03;
  const top = -(logo + gap + 1.6 * t + 2 + 3.4 * e) / 2;
  const y1 = top + logo + gap,
    y2 = y1 + 1.6 * t + 2,
    y3 = y2 + 1.7 * e;
  return {
    hole: { width: logo, height: logo, dy: top + logo / 2 },
    clear: [
      { x: -5.7 * t, y: y1 - 1, width: 11.4 * t, height: 1.6 * t + 2 },
      { x: -6.3 * e, y: y2 - 1, width: 12.6 * e, height: 1.7 * e + 2 },
      { x: -3.3 * e, y: y3 - 1, width: 6.6 * e, height: 1.7 * e + 2 },
    ],
  };
}

const canvasClass = { compact: styles.mastheadCloudCompact, medium: styles.mastheadCloudMedium, wide: styles.mastheadCloudWide };
const layouts = CANVASES.map((c) => ({
  width: c.width,
  height: c.height,
  className: canvasClass[c.key],
  sizes: { ...c.sizes, curve: 0.85, words: 30, irregular: 0.2, ...stack(c) },
}));
// Per-canvas numbers for the CSS, which picks one set per breakpoint.
const frameVars = Object.fromEntries(
  CANVASES.flatMap((c) => [
    [`--${c.key}-w`, c.width],
    [`--${c.key}-h`, c.height],
    [`--${c.key}-max`, `${c.max}px`],
    [`--${c.key}-logo`, c.logo],
    [`--${c.key}-t`, c.tagline],
    [`--${c.key}-e`, c.small],
  ]),
) as React.CSSProperties;

/** The home page's opening: the site mark in the middle of the 正在發酵 cloud,
 *  the day's rising keywords packed around it. SiteHeader hides its own
 *  wordmark while #masthead is in view, so one logo shows at a time. */
export default function MastheadCloud({ edition, tags }: { edition: string; tags: Overview['tags'] }) {
  return (
    <div className={styles.mastheadCloud}>
      <div className={styles.mastheadCloudFrame} style={frameVars} data-vital-region="home-growth-cloud">
        <WordCloud
          canvases={layouts}
          label="部落格標籤文字雲"
          title="依已收錄文章與部落格數呈現"
          words={tags.slice(0, 30).map((tag) => ({
            label: tag.label,
            ariaLabel: `${tag.label}，${tag.postCount} 篇文章，${tag.blogCount} 個部落格`,
            count: Math.max(tag.postCount, tag.blogCount, 1),
            href: `/tags/?tag=${encodeURIComponent(tag.slug)}`,
            tone: 'brand',
            card: {
              rows: [
                ['收錄文章', `${tag.postCount} 篇`],
                ['部落格', `${tag.blogCount} 個`],
              ],
            },
          }))}
        />
        <div className={styles.mastheadCloudCentre}>
          <h1 id="masthead">
            <Logo className={styles.mastheadCloudMark} />
          </h1>
          <p className={styles.mastheadTagline}>每一種生活，各自怎麼寫</p>
          <p className={styles.edition}>{edition}</p>
          <Link href={HOME_CLOUD_HREF} className={styles.mastheadCloudLink}>
            收錄排行 →
          </Link>
        </div>
      </div>
    </div>
  );
}
