// /api/topics/:id `sharedLabels`: the topic label's relations and visual from tag.observe.tw, as the
// gateway already stored them (app/src/topics/shared-label-contract.ts parses the upstream answer). The
// page only reads this payload: nothing here fetches, and nothing runs in the background.
// Pure and browser-safe (no node:crypto, no Buffer): the page re-checks the shape it renders, and any
// snapshot that fails the check is shown as unavailable instead of throwing. The two snapshots fail apart.

export const SHARED_LABEL_ORIGIN = 'https://tag.observe.tw';
/** Relations listed on the page; the rest stay counted, never called complete. */
export const SHARED_LABEL_SHOWN = 24;

export type SharedLabelRelationType = 'is-a' | 'related' | 'alias';
/** parseSharedLabelRelations' result. */
export type SharedLabelRelations = {
  tag: string;
  tagId: string;
  truncated: boolean;
  relations: Array<{
    id: string;
    type: SharedLabelRelationType;
    target: { id: string; label: string; href: string };
    source: 'manual' | 'rule' | 'submission';
    sourceDetail: string;
    createdAt: string | null;
    status: 'approved';
    inherited: boolean;
    depth: number;
  }>;
};
/** parseSharedLabelVisual's result. */
export type SharedLabelVisual = {
  tag: string;
  visual: {
    kind: 'place' | 'flag' | 'logo' | 'emoji';
    emoji: string | null;
    label: string | null;
    wikidataId: string | null;
    image: string | null;
    large: string | null;
    source: { pageUrl: string; license: string | null; licenseUrl: string | null; artist: string | null } | null;
  } | null;
};
export type SharedLabelSnapshot<T> = {
  status: 'ready' | 'missing' | 'unavailable';
  fetchedAt: string | null;
  expiresAt: string | null;
  /** The upstream contract commit the parser follows; not a payload version. */
  sourceContractSha: string;
  /** Upstream sends no payload revision yet. */
  payloadVersion: null;
  data?: T;
};
/** Absent (older gateway or off) and not-enabled both render nothing. */
export type SharedLabels =
  | { status: 'not-enabled' }
  | {
      status: 'enabled';
      source: typeof SHARED_LABEL_ORIGIN;
      relations: SharedLabelSnapshot<SharedLabelRelations>;
      visual: SharedLabelSnapshot<SharedLabelVisual>;
    };

// A declaration, so a bare invalid() call narrows like a throw.
function invalid(): never {
  throw Error('Invalid shared label payload');
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : invalid();
const text = (v: unknown, limit = 512): string =>
  typeof v === 'string' && v.length <= limit * 2 && [...v].length <= limit && !/[\p{Cc}\p{Cs}]/u.test(v) ? v : invalid();
const nullableText = (v: unknown, limit = 512) => (v === null ? null : text(v, limit));
const bool = (v: unknown) => (typeof v === 'boolean' ? v : invalid());
const time = (v: unknown) => {
  const s = nullableText(v, 40);
  return s === null || Number.isFinite(Date.parse(s)) ? s : invalid();
};
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T => (values.includes(v as T) ? (v as T) : invalid());

/** A label the gateway would look up at all (shared-label-client's validTag): no blank edges, Cc/Cs, `.` or `..`. */
export const sharedLabelTagOk = (tag: unknown): tag is string =>
  typeof tag === 'string' &&
  tag.length > 0 &&
  [...tag].length <= 60 &&
  tag === tag.trim() &&
  !/[\p{Cc}\p{Cs}]/u.test(tag) &&
  !['.', '..'].includes(tag);

/**
 * The tag or group page path, or null when tag.observe.tw would resolve it to some other page: like the
 * gateway's parser, the literal must survive URL normalization (`/tag/./` resolves to `/tag/`).
 */
export function sharedLabelPath(path: string): string | null {
  if (!/^\/(?:tag\/[^/?#]+|group\/[1-9]\d*)\/$/.test(path)) return null;
  let u: URL;
  try {
    u = new URL(path, SHARED_LABEL_ORIGIN);
  } catch {
    return null;
  }
  return u.origin === SHARED_LABEL_ORIGIN && u.pathname === path && !u.search && !u.hash ? path : null;
}

function relationsData(raw: unknown, expectedTag: string): SharedLabelRelations {
  const data = object(raw);
  const tag = text(data.tag, 60);
  if (tag !== expectedTag || !tag || !/^[0-9a-f]{64}$/.test(text(data.tagId, 64)) || !Array.isArray(data.relations)) invalid();
  if (data.relations.length > 5000) invalid();
  return {
    tag,
    tagId: data.tagId as string,
    truncated: bool(data.truncated),
    relations: data.relations.map((entry: unknown) => {
      const r = object(entry);
      const target = object(r.target);
      const id = text(target.id, 64);
      const group = /^group:([1-9]\d*)$/.exec(id);
      if (!group && !/^[0-9a-f]{64}$/.test(id)) invalid();
      const label = text(target.label, group ? 32 : 60);
      // Only the tag or group page the id names on tag.observe.tw; no other link is ever built.
      const href = text(target.href, 1024);
      if (href !== (group ? `/group/${group[1]}/` : `/tag/${encodeURIComponent(label)}/`) || !sharedLabelPath(href)) invalid();
      if (r.status !== 'approved' || !Number.isSafeInteger(r.depth) || (r.depth as number) < 1) invalid();
      return {
        id: text(r.id, 128),
        type: oneOf(r.type, ['is-a', 'related', 'alias'] as const),
        target: { id, label, href },
        source: oneOf(r.source, ['manual', 'rule', 'submission'] as const),
        sourceDetail: text(r.sourceDetail, 16),
        createdAt: time(r.createdAt),
        status: 'approved' as const,
        inherited: bool(r.inherited),
        depth: r.depth as number,
      };
    }),
  };
}

/** The upstream's own visual-image path for this tag, with only the parser's v/size/accent query. */
function imagePath(v: unknown, tag: string) {
  if (v === null) return null;
  const path = text(v, 1024);
  const base = `/api/v1/tags/${encodeURIComponent(tag)}/visual-image`;
  if (!path.startsWith(`${base}?`)) invalid();
  const u = new URL(path, SHARED_LABEL_ORIGIN);
  if (u.origin !== SHARED_LABEL_ORIGIN || u.pathname !== base || u.hash) invalid();
  if (!/^[a-z0-9]+$/.test(u.searchParams.get('v') ?? '')) invalid();
  if ([...u.searchParams.keys()].some((k) => !['v', 'size', 'accent'].includes(k))) invalid();
  if (u.searchParams.has('size') && u.searchParams.get('size') !== 'large') invalid();
  if (u.searchParams.has('accent') && !/^[0-9a-f]{6}$/i.test(u.searchParams.get('accent') ?? '')) invalid();
  return path;
}
function httpsUrl(v: unknown, limit = 512) {
  const s = text(v, limit);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return invalid();
  }
  return u.protocol === 'https:' && !u.username && !u.password ? s : invalid();
}

function visualData(raw: unknown, expectedTag: string): SharedLabelVisual {
  const data = object(raw);
  const tag = text(data.tag, 60);
  if (tag !== expectedTag || !tag) invalid();
  if (data.visual === null) return { tag, visual: null };
  const v = object(data.visual);
  const source = v.source === null ? null : object(v.source);
  return {
    tag,
    visual: {
      kind: oneOf(v.kind, ['place', 'flag', 'logo', 'emoji'] as const),
      emoji: nullableText(v.emoji, 64),
      label: nullableText(v.label, 120),
      wikidataId: nullableText(v.wikidataId, 16),
      image: imagePath(v.image, tag),
      large: imagePath(v.large, tag),
      source: source
        ? {
            pageUrl: httpsUrl(source.pageUrl),
            license: nullableText(source.license, 64),
            licenseUrl: source.licenseUrl === null ? null : httpsUrl(source.licenseUrl, 255),
            artist: nullableText(source.artist, 255),
          }
        : null,
    },
  };
}

/** What one snapshot says: missing is "not fetched yet" and ready-empty is the upstream's own empty answer. */
// One member per state, so each `state` check narrows on its own.
type SnapshotMeta = { fetchedAt: string | null; expiresAt: string | null; contractSha: string | null };
export type SnapshotView<T> =
  | ({ state: 'missing' } & SnapshotMeta)
  | ({ state: 'unavailable' } & SnapshotMeta)
  | { state: 'ready'; fetchedAt: string | null; expiresAt: string | null; contractSha: string; data: T };

function snapshot<T>(raw: unknown, parse: (data: unknown) => T): SnapshotView<T> {
  const broken = { state: 'unavailable' as const, fetchedAt: null, expiresAt: null, contractSha: null };
  try {
    const s = object(raw);
    const status = oneOf(s.status, ['ready', 'missing', 'unavailable'] as const);
    const contractSha = /^[0-9a-f]{40}$/.test(String(s.sourceContractSha)) ? (s.sourceContractSha as string) : invalid();
    if (s.payloadVersion !== null) invalid();
    const meta = { fetchedAt: time(s.fetchedAt), expiresAt: time(s.expiresAt), contractSha };
    if (status !== 'ready') return { state: status, ...meta };
    return { state: 'ready', ...meta, data: parse(s.data) };
  } catch {
    return broken;
  }
}

export type SharedLabelsView = {
  source: typeof SHARED_LABEL_ORIGIN;
  /** The topic label's own page on tag.observe.tw. */
  tagHref: string;
  relations: SnapshotView<SharedLabelRelations>;
  visual: SnapshotView<SharedLabelVisual>;
};

/**
 * The block to render, or null for nothing at all: an older payload, not-enabled, or a value that does not
 * even say it is enabled. An enabled value from another source keeps the block with both halves unavailable.
 * A topic label the gateway would never look up, or whose page path would resolve elsewhere, also gets null:
 * there is no snapshot of it and no honest link to its page.
 */
export function sharedLabelsView(raw: unknown, expectedTag: string): SharedLabelsView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as { status?: unknown }).status !== 'enabled') return null;
  const tagPath = sharedLabelTagOk(expectedTag) ? sharedLabelPath(`/tag/${encodeURIComponent(expectedTag)}/`) : null;
  if (!tagPath) return null;
  const value = raw as Record<string, unknown>;
  const trusted = value.source === SHARED_LABEL_ORIGIN;
  return {
    source: SHARED_LABEL_ORIGIN,
    tagHref: sharedLabelUrl(tagPath),
    relations: snapshot(trusted ? value.relations : null, (d) => relationsData(d, expectedTag)),
    visual: snapshot(trusted ? value.visual : null, (d) => visualData(d, expectedTag)),
  };
}

export const relationTypeLabel: Record<SharedLabelRelationType, string> = {
  'is-a': '上位分類',
  related: '相關詞',
  alias: '別名',
};
const relationSourceLabels: Record<SharedLabelRelations['relations'][number]['source'], string> = {
  manual: '人工整理',
  rule: '規則推導',
  submission: '使用者提交',
};
export const relationSourceLabel = (source: keyof typeof relationSourceLabels) => relationSourceLabels[source];

export type RelationGroup = { type: SharedLabelRelationType; label: string; rows: SharedLabelRelations['relations'] };
/**
 * At most SHARED_LABEL_SHOWN relations in upstream order, one row per relation id, grouped is-a, related,
 * alias. All three groups are always returned, an empty one with no rows, so a ready snapshot can say for each
 * kind that nothing is recorded (not hide it). `total` counts distinct ids in the snapshot; `truncated` is the
 * upstream's own flag.
 */
export function relationGroups(data: SharedLabelRelations) {
  const seen = new Set<string>();
  const distinct = data.relations.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  const shown = distinct.slice(0, SHARED_LABEL_SHOWN);
  const groups: RelationGroup[] = (['is-a', 'related', 'alias'] as const).map((type) => ({
    type,
    label: relationTypeLabel[type],
    rows: shown.filter((r) => r.type === type),
  }));
  return { groups, shown: shown.length, total: distinct.length, truncated: data.truncated };
}

/** "共 N 條，顯示前 24 條；上游清單已截斷", saying only what is known. */
export function relationCountText({ shown, total, truncated }: { shown: number; total: number; truncated: boolean }) {
  const fmt = (n: number) => n.toLocaleString('zh-TW');
  return [shown < total ? `本頁收到 ${fmt(total)} 條，只顯示前 ${fmt(shown)} 條` : `共 ${fmt(total)} 條`, truncated ? '清單不完整' : '']
    .filter(Boolean)
    .join('；');
}

/** "直接" or "繼承（第 N 層）": inherited and depth are always said. */
export const relationDepthText = (r: { inherited: boolean; depth: number }) => `${r.inherited ? '繼承' : '直接'}（第 ${r.depth} 層）`;

/** imagePath's check without throwing: the path, or null when it is not this tag's visual-image path. */
export function checkedVisualPath(path: unknown, tag: string): string | null {
  try {
    return imagePath(path, tag);
  } catch {
    return null;
  }
}
/** Absolute tag.observe.tw URL for a checked path. */
export const sharedLabelUrl = (path: string) => `${SHARED_LABEL_ORIGIN}${path}`;

/** The one image to show (the normal size first), or null: no image means no picture and no placeholder. */
export const visualImage = (visual: NonNullable<SharedLabelVisual['visual']>) => {
  const path = visual.image ?? visual.large;
  return path ? sharedLabelUrl(path) : null;
};
