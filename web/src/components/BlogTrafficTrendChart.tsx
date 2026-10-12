'use client';
// ECharts lifecycle/resize/theme pattern from TagCountChart (tag TagChartCanvas, afe0a65).
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { brand, brandMark } from '@/lib/brand';
import { shortMonth } from '@/lib/traffic';

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export type TrendSeries = { name: string; points: Array<{ month: string; visits: number }> };
/** Brand first, then neutral and accent hues that stay apart in light and dark. */
const palette = (dark: boolean) => [
  brandMark(dark),
  dark ? '#a1a1aa' : '#52525b',
  dark ? '#60a5fa' : '#2563eb',
  dark ? '#fbbf24' : '#b45309',
  dark ? '#f472b6' : '#be185d',
  dark ? brand[200] : brand[900],
];

/** One chart for every compared blog. Months a blog has no figure for are gaps (null), never zero. */
export default function BlogTrafficTrendChart({ months, series }: { months: string[]; series: TrendSeries[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const render = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      const axis = dark ? '#a1a1aa' : '#52525b';
      chart.setOption(
        {
          animation: false,
          color: palette(dark),
          tooltip: {
            trigger: 'axis',
            renderMode: 'richText',
            valueFormatter: (value: unknown) =>
              typeof value === 'number' ? `${Math.round(value).toLocaleString('zh-TW')} 次造訪` : '無資料',
          },
          legend: { type: 'scroll', top: 0, textStyle: { color: dark ? '#d4d4d8' : '#3f3f46' } },
          grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
          xAxis: { type: 'category', data: months.map(shortMonth), axisLabel: { color: axis } },
          yAxis: {
            type: 'value',
            axisLabel: { color: axis, formatter: (value: number) => value.toLocaleString('zh-TW', { notation: 'compact' }) },
            splitLine: { lineStyle: { color: dark ? '#27272a' : '#e4e4e7' } },
          },
          series: series.map((s) => {
            const byMonth = new Map(s.points.map((p) => [p.month, p.visits]));
            return {
              name: s.name,
              type: 'line',
              connectNulls: false,
              showSymbol: true,
              symbolSize: 5,
              data: months.map((month) => byMonth.get(month) ?? null),
            };
          }),
        },
        true,
      );
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
  }, [months, series]);
  return <div ref={ref} className="h-full w-full" />;
}
