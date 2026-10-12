'use client';

import { useRouter } from 'next/navigation';
import { type Ref, useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import SuggestInput, { type Suggestion } from '@/components/SuggestInput';

// SuggestInput for plain GET forms rendered by server components, which cannot
// hand a suggest function across the client boundary. `source` names where the
// suggestions come from; picking one fills the box and submits the form (unless
// submitOnPick is off), or
// opens the item's own page when it has one (a topic, a keyword with go).

export type SuggestItem = { value: string; label?: string; hint?: string; media?: string; href?: string };
export type SuggestSource = { kind: 'tags'; go?: boolean };
type TagRow = { slug: string; label: string };
async function suggestionsFor(source: SuggestSource, typed: string, signal: AbortSignal): Promise<SuggestItem[]> {
  const response = await fetch('/api/overview', { signal });
  if (!response.ok) return [];
  const data: { tags?: TagRow[] } = await response.json();
  return (data.tags ?? [])
    .filter((tag) => tag.label.toLocaleLowerCase().includes(typed.toLocaleLowerCase()))
    .slice(0, 8)
    .map((tag) => ({
      value: tag.label,
      href: source.go ? `/tags/?tag=${encodeURIComponent(tag.slug)}` : undefined,
    }));
}

export default function FormSuggestInput({
  source,
  defaultValue = '',
  inputRef,
  onEscape,
  submitOnPick = true,
  wrapperClassName,
  ...input
}: {
  source: SuggestSource;
  /** false in multi-field forms: picking only fills the box. */
  submitOnPick?: boolean;
  showOnEmpty?: boolean;
  name: string;
  defaultValue?: string;
  inputRef?: Ref<HTMLInputElement>;
  onEscape?: () => void;
  id?: string;
  type?: 'search' | 'text';
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  className?: string;
  wrapperClassName?: string;
  'aria-label'?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(defaultValue);
  const own = useRef<HTMLInputElement>(null);
  const items = useRef(new Map<string, SuggestItem>());
  const remote = true;
  // Server components rebuild `source` on every render; key the callback on its contents.
  const sourceKey = JSON.stringify(source);
  const suggest = useCallback(
    async (typed: string, signal: AbortSignal): Promise<Suggestion[]> => {
      const found = await suggestionsFor(JSON.parse(sourceKey) as SuggestSource, typed, signal);
      items.current = new Map(found.map((item) => [item.href ?? item.value, item]));
      return found.map((item) => ({
        key: item.href ?? item.value,
        label: item.label ?? item.value,
        hint: item.hint,
      }));
    },
    [sourceKey],
  );
  return (
    <SuggestInput
      {...input}
      ref={(node) => {
        own.current = node;
        if (typeof inputRef === 'function') inputRef(node);
        else if (inputRef) inputRef.current = node;
      }}
      value={text}
      onValueChange={setText}
      suggest={suggest}
      delay={remote ? 150 : 0}
      wrapperClassName={wrapperClassName}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onEscape?.();
      }}
      onPick={(picked) => {
        const item = items.current.get(picked.key);
        if (!item) return;
        if (item.href) return router.push(item.href);
        flushSync(() => setText(item.value));
        if (submitOnPick) own.current?.form?.requestSubmit();
      }}
    />
  );
}
