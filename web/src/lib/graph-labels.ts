// Placement for the relations graph once its force layout has settled: fit the nodes into the canvas, then keep
// only the names that do not collide with another name or node. echarts' own labelLayout.hideOverlap does not
// apply reliably to a force-laid graph, so names are decided here, most-mentioned blog first.
export type Box = { left: number; top: number; right: number; bottom: number };
export type Margins = { side: number; above: number; below: number };
/** At most this much stretch of one axis over the other when filling a canvas of a different shape. */
const MAX_STRETCH = 1.6;

/** Scale and centre points (any units) into a width×height canvas, leaving room for names at the sides and below. */
export function fitPoints(points: number[][], width: number, height: number, m: Margins): number[][] {
  if (!points.length) return [];
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const boxW = Math.max(1, width - 2 * m.side),
    boxH = Math.max(1, height - m.above - m.below);
  const sx0 = boxW / Math.max(1e-9, right - left),
    sy0 = boxH / Math.max(1e-9, bottom - top);
  const s = Math.min(sx0, sy0);
  const sx = Math.min(sx0, s * MAX_STRETCH),
    sy = Math.min(sy0, s * MAX_STRETCH);
  const cx = m.side + boxW / 2,
    cy = m.above + boxH / 2;
  return points.map(([x, y]) => [cx + (x - (left + right) / 2) * sx, cy + (y - (top + bottom) / 2) * sy]);
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export type LabelCandidate = {
  x: number;
  y: number;
  /** Symbol size in px. */
  size: number;
  /** Measured single-line text width in px. */
  textWidth: number;
  /** Higher ranks claim space first. */
  rank: number;
  /** Only candidates that want a permanent name are considered. */
  wanted: boolean;
};

/** Indexes of the candidates whose name (drawn below the symbol, wrapped at maxWidth) fits without collisions. */
export function placeLabels(
  nodes: LabelCandidate[],
  opts: { maxWidth: number; lineHeight: number; gap: number; pad: number; width: number; height: number },
): Set<number> {
  const symbols: Box[] = nodes.map((n) => ({
    left: n.x - n.size / 2,
    right: n.x + n.size / 2,
    top: n.y - n.size / 2,
    bottom: n.y + n.size / 2,
  }));
  const taken: Box[] = [];
  const shown = new Set<number>();
  const order = nodes.map((_, i) => i).sort((a, b) => nodes[b].rank - nodes[a].rank || a - b);
  for (const i of order) {
    const n = nodes[i];
    if (!n.wanted) continue;
    const w = Math.min(n.textWidth, opts.maxWidth);
    const lines = Math.max(1, Math.ceil(n.textWidth / opts.maxWidth));
    const top = n.y + n.size / 2 + opts.gap;
    const box = {
      left: n.x - w / 2 - opts.pad,
      right: n.x + w / 2 + opts.pad,
      top: top - opts.pad,
      bottom: top + lines * opts.lineHeight + opts.pad,
    };
    if (box.left < 0 || box.right > opts.width || box.bottom > opts.height) continue;
    if (taken.some((t) => overlaps(box, t)) || symbols.some((s, j) => j !== i && overlaps(box, s))) continue;
    taken.push(box);
    shown.add(i);
  }
  return shown;
}
