'use client';
import { lazy } from 'react';
import type { TrendSeries } from './BlogTrafficTrendChart';
import DeferredChart from './DeferredChart';

const Chart = lazy(() => import('./BlogTrafficTrendChart'));
/** Loads the chart runtime only when the comparison scrolls near the viewport. */
export default function BlogTrafficTrend({ months, series }: { months: string[]; series: TrendSeries[] }) {
  return (
    <DeferredChart className="h-64 w-full sm:h-72" label={`月造訪趨勢比較：${series.map((s) => s.name).join('、')}，各月數字見下方表格`}>
      <Chart months={months} series={series} />
    </DeferredChart>
  );
}
