/** Same arrows as the /blogs/ table headers. */
export default function SortIndicator({ active, descending }: { active: boolean; descending: boolean }) {
  return (
    <span aria-hidden="true" className={active ? '' : 'text-zinc-400 dark:text-zinc-600'}>
      {active ? (descending ? '▼' : '▲') : '↕'}
    </span>
  );
}
