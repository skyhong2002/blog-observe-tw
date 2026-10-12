'use client';

import { type InputHTMLAttributes, type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react';

// A text box that lists matches as the reader types (ARIA combobox). Arrow
// keys move through the list, Enter picks the highlighted item, and Enter with
// nothing highlighted keeps the input's normal behaviour (filter or submit).

export type Suggestion = { key: string; label: string; hint?: ReactNode; icon?: ReactNode };

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange'> & {
  ref?: Ref<HTMLInputElement>;
  value: string;
  onValueChange: (value: string) => void;
  /** Must be stable (useCallback); async sources get an abort signal, and may call
   *  `partial` with what they have so far so fast sources show before slow ones. */
  suggest: (text: string, signal: AbortSignal, partial: (items: Suggestion[]) => void) => Suggestion[] | Promise<Suggestion[]>;
  onPick: (suggestion: Suggestion) => void;
  /** Also list suggestions when the box is focused but empty. */
  showOnEmpty?: boolean;
  /** Debounce for async sources, in ms. */
  delay?: number;
  limit?: number;
  wrapperClassName?: string;
};

function Highlight({ label, text }: { label: string; text: string }) {
  const at = text ? label.toLocaleLowerCase().indexOf(text.toLocaleLowerCase()) : -1;
  if (at < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, at)}
      <mark className="bg-transparent font-semibold text-brand-800 dark:text-brand-300">{label.slice(at, at + text.length)}</mark>
      {label.slice(at + text.length)}
    </>
  );
}

export default function SuggestInput({
  value,
  onValueChange,
  suggest,
  onPick,
  showOnEmpty = false,
  delay = 0,
  limit = 8,
  wrapperClassName = '',
  onFocus,
  onBlur,
  onKeyDown,
  ...input
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const text = value.trim();
  useEffect(() => {
    if (!open || (!text && !showOnEmpty)) {
      setItems([]);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const partial = (some: Suggestion[]) => {
          if (!abort.signal.aborted) setItems(some.slice(0, limit));
        };
        const next = await suggest(text, abort.signal, partial);
        if (!abort.signal.aborted) {
          setItems(next.slice(0, limit));
          setActive(-1);
        }
      } catch {
        if (!abort.signal.aborted) setItems([]);
      }
    }, delay);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [open, text, showOnEmpty, suggest, delay, limit]);
  useEffect(() => {
    if (active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const pick = (item: Suggestion) => {
    setOpen(false);
    onPick(item);
  };
  const expanded = open && items.length > 0;
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...input}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-activedescendant={expanded && active >= 0 ? `${id}-${active}` : undefined}
        autoComplete="off"
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
        }}
        onFocus={(event) => {
          setOpen(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setOpen(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!expanded) return setOpen(true);
            // Cycle through -1 (nothing highlighted, the typed text) and each item.
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((index) => ((index + 1 + step + items.length + 1) % (items.length + 1)) - 1);
          } else if (event.key === 'Enter' && expanded && active >= 0 && items[active]) {
            event.preventDefault();
            pick(items[active]);
          } else if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            setOpen(false);
          }
          // Escape that only closed the list should not also close what holds the box.
          if (!event.defaultPrevented || event.key !== 'Escape') onKeyDown?.(event);
        }}
      />
      {expanded && (
        <div
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          className="absolute top-full left-0 z-30 mt-1 max-h-80 w-max min-w-full max-w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {items.map((item, index) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: The combobox input handles arrow keys and Enter for every option.
            <div
              key={item.key}
              id={`${id}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(item)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${index === active ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate text-zinc-900 dark:text-zinc-100">
                <Highlight label={item.label} text={text} />
              </span>
              {item.hint && <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{item.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
