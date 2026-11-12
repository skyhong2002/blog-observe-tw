import type { ReactNode } from 'react';
import Link from './NoPrefetchLink';

/**
 * One look for every "nothing here" and "something went wrong" message: an icon, a title, a sentence on what
 * happened and what to do next, then the actions. `tone` carries meaning in colour and in the icon, never colour
 * alone: empty (neutral), notice (amber, data not ready yet) or error (red, a read failed).
 */
export type StateTone = 'empty' | 'notice' | 'error';
export type StateAction = { href: string; label: string; primary?: boolean; external?: boolean };

const frame: Record<StateTone, string> = {
  empty: 'border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900',
  notice: 'border-amber-300 bg-amber-50 dark:border-amber-800/70 dark:bg-amber-950/40',
  error: 'border-red-300 bg-red-50 dark:border-red-900/70 dark:bg-red-950/40',
};
const badge: Record<StateTone, string> = {
  empty: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  notice: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200',
};

function Icon({ tone }: { tone: StateTone }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
  } as const;
  if (tone === 'error')
    return (
      <svg aria-hidden="true" {...common} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 2.5 20h19L12 3Z" />
        <path d="M12 10v4.5M12 17.5h.01" />
      </svg>
    );
  if (tone === 'notice')
    return (
      <svg aria-hidden="true" {...common} strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    );
  return (
    <svg aria-hidden="true" {...common} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

export const stateActionClass = (primary = false) =>
  primary
    ? 'inline-flex min-h-10 items-center rounded-full bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
    : 'inline-flex min-h-10 items-center rounded-full border border-zinc-300 bg-white px-4 text-sm text-zinc-800 hover:border-brand-700 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-brand-400 dark:hover:text-brand-300';

export default function StateNotice({
  tone = 'empty',
  title,
  children,
  actions = [],
  extra,
  className = '',
  headingLevel = 2,
  role,
}: {
  tone?: StateTone;
  title: ReactNode;
  children?: ReactNode;
  actions?: StateAction[];
  /** Anything after the actions, such as a retry button or a suggestion form. */
  extra?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2 | 3;
  role?: 'status' | 'alert';
}) {
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3';
  return (
    <section
      role={role ?? (tone === 'error' ? 'alert' : undefined)}
      className={`rounded-2xl border p-5 sm:p-6 ${frame[tone]} ${className}`}
    >
      <div className="flex gap-4">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${badge[tone]}`}>
          <Icon tone={tone} />
        </span>
        <div className="min-w-0 space-y-2">
          <Heading className={`${headingLevel === 1 ? 'text-2xl' : 'text-lg'} font-semibold leading-snug text-zinc-900 dark:text-zinc-50`}>
            {title}
          </Heading>
          {children && <div className="text-[0.9375rem] leading-7 text-zinc-700 dark:text-zinc-300">{children}</div>}
          {actions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {actions.map((action) =>
                action.external ? (
                  <a key={action.href} href={action.href} rel="noopener noreferrer" className={stateActionClass(action.primary)}>
                    {action.label}
                  </a>
                ) : (
                  <Link key={action.href} href={action.href} className={stateActionClass(action.primary)}>
                    {action.label}
                  </Link>
                ),
              )}
            </div>
          )}
          {extra}
        </div>
      </div>
    </section>
  );
}
