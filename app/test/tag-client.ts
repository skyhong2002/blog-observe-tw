import { type TagClient, TagServiceError, type TrafficTagItem } from '../src/blog-genres/traffic.ts';

/** traffic.observe.tw is never reached from a test: every read and write fails as if it were down. */
export const offlineTagClient: TagClient = {
  read: async () => {
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

/** A traffic stand-in holding these domains' tags; it records every read. */
export function fakeTagClient(domains: Record<string, TrafficTagItem[]>) {
  const reads: Array<{ domains: string[] }> = [];
  const client: TagClient = {
    read: async (list) => {
      reads.push({ domains: list });
      return { domains: Object.fromEntries(list.filter((d) => Object.hasOwn(domains, d)).map((d) => [d, domains[d]])) };
    },
    putAi: async (sites) => ({ ok: true, sites: sites.length, changed: 0, skipped: [] }),
  };
  return { client, reads };
}
