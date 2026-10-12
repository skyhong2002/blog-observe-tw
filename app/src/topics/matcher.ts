import { createHash } from 'node:crypto';

export const normalizeTerm = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const latin = (value: string | undefined) => Boolean(value && /[\p{Script=Latin}\p{Number}_]/u.test(value));
type Node = { next: Map<string, number>; failure: number; terminal: string[]; output: number };
/** Bounded Aho-Corasick trie: no terms × articles regular-expression scan. */
export class TopicMatcher {
  private readonly nodes: Node[] = [{ next: new Map(), failure: 0, terminal: [], output: 0 }];
  private readonly labels = new Map<string, string>();
  constructor(terms: { id: string; label: string }[]) {
    if (terms.length > 250_000) throw Error('topic term cap');
    for (const term of terms) {
      const label = normalizeTerm(term.label);
      if (!label || label.length > 255) continue;
      this.labels.set(term.id, label);
      let state = 0;
      for (const char of label) {
        let child = this.nodes[state].next.get(char);
        if (child === undefined) {
          if (this.nodes.length >= 1_000_000) throw Error('topic trie cap');
          child = this.nodes.length;
          this.nodes[state].next.set(char, child);
          this.nodes.push({ next: new Map(), failure: 0, terminal: [], output: 0 });
        }
        state = child;
      }
      this.nodes[state].terminal.push(term.id);
    }
    const queue = [...this.nodes[0].next.values()];
    for (let at = 0; at < queue.length; at++) {
      const state = queue[at];
      for (const [char, child] of this.nodes[state].next) {
        queue.push(child);
        let fallback = this.nodes[state].failure;
        while (fallback && !this.nodes[fallback].next.has(char)) fallback = this.nodes[fallback].failure;
        this.nodes[child].failure = this.nodes[fallback].next.get(char) ?? 0;
        const failed = this.nodes[child].failure;
        this.nodes[child].output = this.nodes[failed].terminal.length ? failed : this.nodes[failed].output;
      }
    }
  }
  match(input: string, cap = 200): { ids: string[]; truncated: boolean } {
    const text = normalizeTerm(input.slice(0, 60_000));
    const chars = [...text];
    let state = 0;
    const found = new Set<string>();
    let transitions = 0;
    for (let pos = 0; pos < chars.length; pos++) {
      while (state && !this.nodes[state].next.has(chars[pos])) state = this.nodes[state].failure;
      state = this.nodes[state].next.get(chars[pos]) ?? 0;
      let output = state;
      do {
        for (const id of this.nodes[output].terminal) {
          if (++transitions > 100_000) return { ids: [...found], truncated: true };
          const label = [...this.labels.get(id)!];
          if ((latin(label[0]) && latin(chars[pos - label.length])) || (latin(label.at(-1)) && latin(chars[pos + 1]))) continue;
          found.add(id);
          if (found.size >= cap) return { ids: [...found], truncated: true };
        }
        output = this.nodes[output].output;
      } while (output);
    }
    return { ids: [...found], truncated: input.length > 60_000 };
  }
}
export const blogContribution = (posts: number) => 2 * (1 - 0.5 ** Math.max(0, posts));
export function withinWindow(publishedAt: Date | string | null, days: number, now: Date): boolean {
  if (!publishedAt) return false;
  const timestamp = new Date(publishedAt).getTime();
  return timestamp <= now.getTime() && timestamp >= now.getTime() - days * 86400_000;
}
