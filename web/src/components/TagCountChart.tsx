'use client';
// ECharts lifecycle/resize pattern ported from tag's TagChartCanvas (afe0a65).
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);
export default function TagCountChart({ rows }: { rows: Array<{ label: string; blogCount: number }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const render = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      chart.setOption({
        animation: false,
        tooltip: { trigger: 'axis', renderMode: 'richText' },
        grid: { left: 100, right: 30, top: 10, bottom: 35 },
        xAxis: {
          type: 'value',
          minInterval: 1,
          axisLabel: { color: dark ? '#a1a1aa' : '#52525b' },
          splitLine: { lineStyle: { color: dark ? '#27272a' : '#e4e4e7' } },
        },
        yAxis: {
          type: 'category',
          inverse: true,
          data: rows.map((r) => r.label),
          axisLabel: { color: dark ? '#d4d4d8' : '#3f3f46', width: 90, overflow: 'truncate' },
        },
        series: [{ name: '參與部落格', type: 'bar', data: rows.map((r) => r.blogCount), itemStyle: { color: '#d9480f' }, barMaxWidth: 22 }],
      });
    };
    render();
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(ref.current);
    const theme = new MutationObserver(render);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      resize.disconnect();
      theme.disconnect();
      chart.dispose();
    };
  }, [rows]);
  return <div ref={ref} className="h-full w-full" />;
}
