/**
 * Placeholder rows under a pending section's status line: the card a ranking or relation list will fill, so the
 * page keeps its height while the read is in flight. Decorative only (the status line says what is loading); no
 * made-up names, ranks or numbers. Pulses only when the reader allows motion.
 */
const WIDTHS = [46, 34, 58, 40, 52, 30];

export default function PendingRows({ rows = 6 }: { rows?: number }) {
  const ids = Array.from({ length: rows }, (_, i) => i);
  return (
    <div aria-hidden="true" className="space-y-3 rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {ids.map((row) => (
        <div key={row} className="flex items-center gap-3">
          <span className="h-3 w-5 shrink-0 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
          <span
            className="h-3.5 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800"
            style={{ width: `${WIDTHS[row % WIDTHS.length]}%` }}
          />
          <span className="ml-auto h-3 w-12 shrink-0 rounded bg-zinc-100 motion-safe:animate-pulse dark:bg-zinc-800/60" />
        </div>
      ))}
    </div>
  );
}
