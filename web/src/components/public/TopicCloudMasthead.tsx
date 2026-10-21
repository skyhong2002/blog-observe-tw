import type { ReactNode } from 'react';
import WordCloud from '@/components/WordCloud';
import type { TopicCloudWord } from '@/lib/topic-cloud';
import styles from './TopicCloudMasthead.module.css';

// The topic pages' opening, drawn like the homepage masthead (app/_home/MastheadCloud.tsx): the page title in the
// middle of its own ranking's word cloud. Three canvases, one per breakpoint (TopicCloudMasthead.module.css); the
// title and the line under it are sized in canvas units so they scale with the words and never overlap them.
// Without words (still loading, or an empty ranking) the title keeps its place and the frame stays empty.

interface Canvas {
  key: 'compact' | 'medium' | 'wide';
  width: number;
  height: number;
  /** Widest the frame may grow, in CSS px. */
  max: number;
  /** Title and the line under it, in canvas units. */
  title: number;
  line: number;
  sizes: { min: number; max: number; floor: number; budget: number; gap: number; markGap: number; scatter: number };
}
const CANVASES: Canvas[] = [
  {
    key: 'compact',
    width: 340,
    height: 300,
    max: 420,
    title: 24,
    line: 12,
    sizes: { min: 10, max: 27, floor: 9, budget: 0.9, gap: 7, markGap: 10, scatter: 900 },
  },
  {
    key: 'medium',
    width: 680,
    height: 280,
    max: 780,
    title: 30,
    line: 13,
    sizes: { min: 11, max: 36, floor: 10, budget: 0.85, gap: 10, markGap: 14, scatter: 1400 },
  },
  {
    key: 'wide',
    width: 1120,
    height: 300,
    max: 1120,
    title: 34,
    line: 13,
    sizes: { min: 12, max: 44, floor: 11, budget: 0.8, gap: 14, markGap: 20, scatter: 2000 },
  },
];

/** Rendered width of a line in canvas units: CJK glyphs one em, Latin about two thirds (as lib/word-cloud.mts). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Latin vs CJK width estimate, as lib/word-cloud.mts.
const widthOf = (text: string, size: number) => Array.from(text).reduce((n, c) => n + (/[^\u0000-ÿ]/.test(c) ? 1 : 0.6), 0) * size;

/** The title box (hole) and the line under it (clear), centred on the canvas like the homepage's mark and tagline. */
function centre(c: Canvas, title: string, line: string) {
  const titleHeight = c.title * 1.35;
  const lineHeight = c.line * 1.7;
  const top = -(titleHeight + lineHeight) / 2;
  const lineWidth = widthOf(line, c.line) + 8;
  return {
    hole: { width: widthOf(title, c.title) + 12, height: titleHeight, dy: top + titleHeight / 2 },
    clear: [{ x: -lineWidth / 2, y: top + titleHeight, width: lineWidth, height: lineHeight }],
  };
}

const canvasClass = { compact: styles.compact, medium: styles.medium, wide: styles.wide };
const frameVars = Object.fromEntries(
  CANVASES.flatMap((c) => [
    [`--${c.key}-w`, c.width],
    [`--${c.key}-h`, c.height],
    [`--${c.key}-max`, `${c.max}px`],
    [`--${c.key}-title`, c.title],
    [`--${c.key}-line`, c.line],
  ]),
) as React.CSSProperties;

export default function TopicCloudMasthead({
  title,
  line,
  lineText,
  words,
  label,
}: {
  title: string;
  /** The line under the title (period · method link); `lineText` is its plain text, for the space it needs. */
  line: ReactNode;
  lineText: string;
  words: TopicCloudWord[];
  /** The cloud's accessible name. */
  label: string;
}) {
  const canvases = CANVASES.map((c) => ({
    width: c.width,
    height: c.height,
    className: canvasClass[c.key],
    sizes: { ...c.sizes, curve: 0.85, words: 30, irregular: 0.2, ...centre(c, title, lineText) },
  }));
  return (
    <div className={styles.frame} style={frameVars}>
      {words.length ? <WordCloud canvases={canvases} label={label} title={label} words={words} /> : null}
      <div className={styles.centre}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.line}>{line}</p>
      </div>
    </div>
  );
}
