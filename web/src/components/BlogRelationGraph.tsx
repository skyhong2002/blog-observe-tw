'use client';
// GraphChart and lifecycle/resize/theme pattern adapted from tag afe0a65
// SimilarityGraph and the shared TagCountChart; graph values are blog mentions.
import { GraphChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { brandMark } from '@/lib/brand';
import { blogHref } from '@/lib/page-links';
import type { RelationEdge, RelationNode } from '@/lib/relations';

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);
const LABEL_WIDTH_NARROW = 96;
type GraphData = { count(): number; getItemLayout(i: number): unknown };
export default function BlogRelationGraph({ nodes, edges }: { nodes: RelationNode[]; edges: RelationEdge[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    let fitted = false;
    const render = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      // Phones: shorter edges keep nodes apart inside a 390px canvas.
      const narrow = (ref.current?.clientWidth ?? 0) < 480;
      fitted = !narrow;
      chart.setOption({
        animation: false,
        tooltip: {
          renderMode: 'richText',
          formatter: (p: { dataType?: string; name?: string; data?: { value?: number } }) =>
            p.dataType === 'edge' ? `${p.data?.value ?? 0} 篇文章提及` : (p.name ?? ''),
        },
        series: [
          {
            type: 'graph',
            layout: 'force',
            roam: true,
            // Settled before the first paint, so the phone fit below sees final positions.
            force: narrow
              ? { repulsion: 220, edgeLength: [70, 120], layoutAnimation: false }
              : { repulsion: 180, edgeLength: [90, 170], layoutAnimation: false },
            edgeSymbol: ['none', 'arrow'],
            edgeSymbolSize: 7,
            // Full names wrap onto a second line instead of being cut with an ellipsis.
            label: {
              show: true,
              position: 'bottom',
              color: dark ? '#d4d4d8' : '#3f3f46',
              fontSize: narrow ? 13 : 12,
              lineHeight: narrow ? 16 : 15,
              width: narrow ? LABEL_WIDTH_NARROW : 128,
              overflow: 'break',
            },
            lineStyle: { color: dark ? '#a1a1aa' : '#71717a', opacity: 0.55, curveness: 0.12 },
            emphasis: { focus: 'adjacency' },
            data: nodes
              .filter((n) => edges.some((e) => e.sourceBlogId === n.id || e.targetBlogId === n.id))
              .map((n) => ({ id: String(n.id), name: n.name, symbolSize: 22, itemStyle: { color: brandMark(dark) } })),
            links: edges.map((e) => ({
              source: String(e.sourceBlogId),
              target: String(e.targetBlogId),
              value: e.count,
              lineStyle: { width: Math.min(6, 1 + Math.log2(1 + e.count)) },
            })),
          },
        ],
      });
    };
    // A force layout has no bounds: on a phone a node can settle at the canvas edge with its label cut off.
    // Once laid out, pan and (only ever) shrink the view so every node and its label fits the canvas.
    chart.on('finished', () => {
      if (fitted) return;
      fitted = true;
      const data = (chart as unknown as { getModel(): { getSeriesByIndex(i: number): { getData(): GraphData } | undefined } })
        .getModel()
        .getSeriesByIndex(0)
        ?.getData();
      const points = Array.from({ length: data?.count() ?? 0 }, (_, i) => data?.getItemLayout(i))
        .filter((p): p is number[] => Array.isArray(p))
        .map((p) => chart.convertToPixel({ seriesIndex: 0 }, p) as number[]);
      if (!points.length) return;
      const xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]);
      const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const side = LABEL_WIDTH_NARROW / 2 + 6,
        above = 18,
        below = 54;
      const width = chart.getWidth(),
        height = chart.getHeight();
      const zoom = Math.min(1, (width - 2 * side) / Math.max(1, right - left), (height - above - below) / Math.max(1, bottom - top));
      const cx = width / 2,
        cy = above + (height - above - below) / 2;
      chart.dispatchAction({ type: 'graphRoam', seriesIndex: 0, dx: cx - (left + right) / 2, dy: cy - (top + bottom) / 2 });
      if (zoom < 1) chart.dispatchAction({ type: 'graphRoam', seriesIndex: 0, zoom, originX: cx, originY: cy });
    });
    render();
    chart.on('click', (p: { dataType?: string; data?: unknown }) => {
      if (p.dataType === 'node') {
        const id = (p.data as { id: string }).id;
        const n = nodes.find((n) => String(n.id) === id);
        if (n) window.location.assign(blogHref(n.slug, n.canonicalPath));
      }
    });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(ref.current);
    const theme = new MutationObserver(render);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      resize.disconnect();
      theme.disconnect();
      chart.dispose();
    };
  }, [nodes, edges]);
  return (
    <div
      ref={ref}
      className="h-[440px] w-full"
      role="img"
      aria-label="部落格正文提及關係圖；箭頭指向被提及的部落格，詳細資料列於下方表格"
    />
  );
}
