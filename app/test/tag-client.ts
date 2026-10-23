import { type TagClient, TagServiceError, type TagWrite, type TrafficTagItem } from '../src/blog-genres/traffic.ts';

/** traffic.observe.tw is never reached from a test: every read and write fails as if it were down. */
export const offlineTagClient: TagClient = {
  read: async () => {
    throw new TagServiceError('tag-service-test');
  },
  write: async () => {
    throw new TagServiceError('tag-service-test');
  },
  putAi: async () => {
    throw new TagServiceError('tag-service-test');
  },
};

export const tag = (name: string, patch: Partial<TrafficTagItem> = {}): TrafficTagItem => ({
  tag: name,
  source: 'ai',
  visible: true,
  agrees: 0,
  disagrees: 0,
  adminOverride: null,
  ...patch,
});

/** A traffic stand-in holding these domains' tags; it records every call and answers writes with `answer`. */
export function fakeTagClient(
  domains: Record<string, TrafficTagItem[]>,
  {
    voter,
    answer,
  }: {
    voter?: { admin: boolean; votes: Record<string, Record<string, number>> };
    answer?: (change: TagWrite) => Awaited<ReturnType<TagClient['write']>>;
  } = {},
) {
  const reads: Array<{ domains: string[]; voter?: string }> = [];
  const writes: TagWrite[] = [];
  const client: TagClient = {
    read: async (list, email) => {
      reads.push({ domains: list, ...(email ? { voter: email } : {}) });
      return {
        domains: Object.fromEntries(list.filter((d) => Object.hasOwn(domains, d)).map((d) => [d, domains[d]])),
        ...(email ? { voter: { email, admin: voter?.admin ?? false, votes: voter?.votes ?? {} } } : {}),
      };
    },
    write: async (change) => {
      writes.push(change);
      return answer ? answer(change) : { ok: true, domain: change.domain, tag: change.tag, tags: domains[change.domain] ?? [] };
    },
    putAi: async (sites) => ({ ok: true, sites: sites.length, changed: 0, skipped: [] }),
  };
  return { client, reads, writes };
}
