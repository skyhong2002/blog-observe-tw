'use client';
import { lazy } from 'react';
import DeferredChart from './DeferredChart';

const Chart = lazy(() => import('./TagCountChart'));
export default function TagCountChartLoader({ rows }: { rows: Array<{ label: string; blogCount: number }> }) {
  return (
    <DeferredChart className="h-80 w-full" label="各標籤參與部落格數，完整數字見下方表格">
      <Chart rows={rows} />
    </DeferredChart>
  );
}
