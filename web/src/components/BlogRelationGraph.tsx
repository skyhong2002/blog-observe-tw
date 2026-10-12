'use client';
// GraphChart and lifecycle/resize/theme pattern adapted from tag afe0a65
// SimilarityGraph and the shared TagCountChart; graph values are blog mentions.
import { GraphChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { brandMark } from '@/lib/brand';
import type { RelationEdge, RelationNode } from '@/lib/relations';

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);
export default function BlogRelationGraph({ nodes, edges }: { nodes: RelationNode[]; edges: RelationEdge[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const render = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
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
            force: { repulsion: 180, edgeLength: [90, 170] },
            edgeSymbol: ['none', 'arrow'],
            edgeSymbolSize: 7,
            label: {
              show: true,
              position: 'bottom',
              color: dark ? '#d4d4d8' : '#3f3f46',
              fontSize: 11,
              formatter: (p: { name: string }) => (p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name),
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
    render();
    chart.on('click', (p: { dataType?: string; data?: unknown }) => {
      if (p.dataType === 'node') {
        const id = (p.data as { id: string }).id;
        const n = nodes.find((n) => String(n.id) === id);
        if (n) window.location.assign(`/blogs/${encodeURIComponent(n.slug)}/`);
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
