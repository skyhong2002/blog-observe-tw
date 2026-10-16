'use client';
// GraphChart and lifecycle/resize/theme pattern adapted from tag afe0a65
// SimilarityGraph and the shared TagCountChart; graph values are blog mentions.
import { GraphChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { brandMark } from '@/lib/brand';
import { fitPoints, type LabelSide, placeLabels } from '@/lib/graph-labels';
import { mediaIconSrc, mediaIcons } from '@/lib/media-icons';
import { blogHref } from '@/lib/page-links';
import type { RelationEdge, RelationNode } from '@/lib/relations';

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);
const LABEL_WIDTH_NARROW = 96,
  LABEL_WIDTH = 128;
const ICON_WAIT_MS = 2500;
const LABELLED_MENTIONS = 2;
// The most-mentioned blogs keep their names even in a crowd, drawn over other icons (with a halo) if need be.
const MUST_LABEL = 5;
type GraphData = { count(): number; getItemLayout(i: number): unknown };
/** The icon URLs that actually load within ICON_WAIT_MS; a node whose icon fails keeps the green dot. */
function loadedIcons(urls: string[]): Promise<Set<string>> {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise<string | null>((resolve) => {
          const image = new Image();
          const timer = setTimeout(() => resolve(null), ICON_WAIT_MS);
          image.onload = () => {
            clearTimeout(timer);
            resolve(url);
          };
          image.onerror = () => {
            clearTimeout(timer);
            resolve(null);
          };
          image.referrerPolicy = 'no-referrer';
          image.src = url;
        }),
    ),
  ).then((list) => new Set(list.filter((url): url is string => url !== null)));
}
function extent(points: number[][]) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const left = Math.min(...xs),
    top = Math.min(...ys);
  return { left, top, width: Math.max(1, Math.max(...xs) - left), height: Math.max(1, Math.max(...ys) - top) };
}
export default function BlogRelationGraph({ nodes, edges }: { nodes: RelationNode[]; edges: RelationEdge[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    let disposed = false,
      loaded = new Set<string>(),
      // Where the force layout settled (its own units); null until it has run once.
      settled: number[][] | null = null,
      placed: { points: number[][]; sides: Map<number, LabelSide> } | null = null;
    const linked = nodes.filter((n) => edges.some((e) => e.sourceBlogId === n.id || e.targetBlogId === n.id));
    const icon = new Map(linked.map((n) => [n.id, mediaIconSrc(n.slug, mediaIcons, n.iconUrl)]));
    // Mentions received: the most-cited blogs are drawn larger, and their names win when names would collide.
    const incoming = new Map<number, number>();
    for (const e of edges) incoming.set(e.targetBlogId, (incoming.get(e.targetBlogId) ?? 0) + e.count);
    // Phones: shorter edges and smaller symbols keep nodes (and some names) apart inside a 390px canvas.
    const isNarrow = () => chart.getWidth() < 480;
    const symbolSize = (n: RelationNode) =>
      Math.round((isNarrow() ? 0.75 : 1) * (20 + Math.min(16, 4 * Math.log2(1 + (incoming.get(n.id) ?? 0)))));
    const labelStyle = () => {
      const narrow = isNarrow();
      return {
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: narrow ? 13 : 12,
        lineHeight: narrow ? 16 : 15,
        width: narrow ? LABEL_WIDTH_NARROW : LABEL_WIDTH,
      };
    };
    const render = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      const narrow = isNarrow();
      chart.setOption(
        {
          animation: false,
          tooltip: {
            renderMode: 'richText',
            formatter: (p: { dataType?: string; name?: string; data?: { value?: number } }) =>
              p.dataType === 'edge' ? `${p.data?.value ?? 0} 篇文章提及` : (p.name ?? ''),
          },
          series: [
            {
              type: 'graph',
              // First a force layout; once settled, the nodes are pinned where they landed (see place()).
              layout: placed ? 'none' : 'force',
              // Pinned points are already fitted to the canvas in pixels. echarts scales a graph's points into its
              // box, so the box is exactly their extent: an identity mapping.
              ...(placed ? extent(placed.points) : {}),
              roam: true,
              force: narrow
                ? { repulsion: 260, edgeLength: [50, 100], gravity: 0.25, layoutAnimation: false }
                : { repulsion: 180, edgeLength: [90, 170], gravity: 0.15, layoutAnimation: false },
              edgeSymbol: ['none', 'arrow'],
              edgeSymbolSize: 7,
              // Names in the page's own font; a long one wraps onto a second line rather than being cut.
              // Every name shows on hover; on the map only those placed without colliding (see placeLabels).
              emphasis: { focus: 'adjacency', label: { show: true } },
              label: {
                show: true,
                position: 'bottom',
                color: dark ? '#d4d4d8' : '#3f3f46',
                // A halo in the page background keeps a name readable where it crosses edges or icons.
                textBorderColor: dark ? '#18181b' : '#ffffff',
                textBorderWidth: 3,
                overflow: 'break',
                ...labelStyle(),
              },
              lineStyle: { color: dark ? '#a1a1aa' : '#71717a', opacity: 0.55, curveness: 0.12 },
              // Each blog is drawn as its own icon; without one (or when it does not load), a green dot.
              data: linked.map((n, i) => {
                const src = icon.get(n.id);
                return {
                  id: String(n.id),
                  name: n.name,
                  ...(placed ? { x: placed.points[i][0], y: placed.points[i][1] } : {}),
                  symbol: src && loaded.has(src) ? `image://${src}` : 'circle',
                  symbolSize: symbolSize(n),
                  label: { show: placed?.sides.has(i) ?? false, position: placed?.sides.get(i) ?? 'bottom' },
                  itemStyle: { color: brandMark(dark) },
                };
              }),
              links: edges.map((e) => ({
                source: String(e.sourceBlogId),
                target: String(e.targetBlogId),
                value: e.count,
                lineStyle: { width: Math.min(6, 1 + Math.log2(1 + e.count)) },
              })),
            },
          ],
        },
        { replaceMerge: ['series'] },
      );
    };
    // A force layout has no bounds, and echarts' hideOverlap does not hold for it: fit the settled nodes into the
    // canvas here, then give names (most-mentioned first) only where they collide with no other name or node.
    const place = () => {
      if (!settled) return;
      const style = labelStyle();
      const width = chart.getWidth(),
        height = chart.getHeight();
      const points = fitPoints(settled, width, height, { side: 18, above: 18, below: 2 * style.lineHeight + 8 });
      const measure = document.createElement('canvas').getContext('2d');
      if (measure) measure.font = `${style.fontSize}px ${style.fontFamily}`;
      const sides = placeLabels(
        linked.map((n, i) => ({
          x: points[i][0],
          y: points[i][1],
          size: symbolSize(n),
          textWidth: measure ? measure.measureText(n.name).width : n.name.length * style.fontSize,
          rank: incoming.get(n.id) ?? 0,
          wanted: (incoming.get(n.id) ?? 0) >= LABELLED_MENTIONS,
        })),
        { maxWidth: style.width, lineHeight: style.lineHeight, gap: 5, pad: 2, width, height, mustShow: MUST_LABEL },
      );
      placed = { points, sides };
      render();
    };
    chart.on('finished', () => {
      if (settled) return;
      // A resize before the icons load also fires 'finished', on a chart with no option (and no model) yet.
      const data = (chart as unknown as { getModel(): { getSeriesByIndex(i: number): { getData(): GraphData } | undefined } | undefined })
        .getModel()
        ?.getSeriesByIndex(0)
        ?.getData();
      const points = Array.from({ length: data?.count() ?? 0 }, (_, i) => data?.getItemLayout(i)).filter((p): p is number[] =>
        Array.isArray(p),
      );
      if (!points.length || points.length !== linked.length) return;
      settled = points.map((p) => [p[0], p[1]]);
      // Outside echarts' own render pass, which is what fires 'finished'.
      setTimeout(() => !disposed && place(), 0);
    });
    // Wait (briefly) for the icons, so the force layout runs once with the final symbols.
    void loadedIcons([...new Set([...icon.values()].filter((src): src is string => Boolean(src)))]).then((ok) => {
      if (disposed) return;
      loaded = ok;
      render();
    });
    chart.on('click', (p: { dataType?: string; data?: unknown }) => {
      if (p.dataType === 'node') {
        const id = (p.data as { id: string }).id;
        const n = nodes.find((n) => String(n.id) === id);
        if (n) window.location.assign(blogHref(n.slug, n.canonicalPath));
      }
    });
    // Same settled layout, refitted (and its names re-placed) to the new size.
    const resize = new ResizeObserver(() => {
      chart.resize();
      place();
    });
    resize.observe(ref.current);
    const theme = new MutationObserver(render);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      disposed = true;
      resize.disconnect();
      theme.disconnect();
      chart.dispose();
    };
  }, [nodes, edges]);
  return (
    <div
      ref={ref}
      className="h-[520px] w-full lg:h-[600px]"
      role="img"
      aria-label="部落格正文提及關係圖；箭頭指向被提及的部落格，詳細資料列於下方表格"
    />
  );
}
