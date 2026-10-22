// One-off repair for content_blog_rules.platform values guessed before the platform came from the page's own document
// (tech/platform.ts): a blog whose feed content showed another site's wp-content image was stored as WordPress for good.
// Evidence is what we already hold — the blog's own technology observation — plus, for blogs named on the command line, one
// fresh read of the home page. Manual rules are never touched.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { DOCUMENT_PLATFORMS, type DocumentPlatform } from '../tech/platform.ts';

export type PlatformChange = {
  blogId: number;
  slug: string;
  from: string;
  to: DocumentPlatform;
  evidence: 'technology-scan' | 'home-page';
};
export type PlatformRepairPlan = {
  changes: PlatformChange[];
  /** Inferred rules whose platform no evidence we hold either confirms or contradicts. */
  unverified: { blogId: number; slug: string; platform: string }[];
  /** Inferred rules the evidence confirms. */
  confirmed: number;
};

type RuleRow = RowDataPacket & { blogId: number; slug: string; platform: string; detections: unknown; scanStatus: string | null };
type Detection = { id?: unknown; confidence?: unknown };

const asList = (value: unknown): Detection[] => {
  let parsed: unknown = value;
  if (typeof value === 'string')
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  return Array.isArray(parsed) ? (parsed as Detection[]) : [];
};

/** The platform a technology scan names: the most confident blogging platform among its detections, if one stands alone. */
export function scanPlatform(value: unknown): DocumentPlatform | null {
  const found = asList(value)
    .filter(
      (d): d is { id: DocumentPlatform; confidence: number } =>
        DOCUMENT_PLATFORMS.includes(d.id as DocumentPlatform) && typeof d.confidence === 'number',
    )
    .sort((a, b) => b.confidence - a.confidence);
  if (!found.length || found[0].confidence < 0.7) return null;
  if (found[1] && found[1].confidence === found[0].confidence) return null;
  return found[0].id;
}

/**
 * Compares every inferred platform with the blog's technology scan. `fresh` carries platforms read from a page just
 * fetched for named blogs (blog id → platform, null when the page named none); it outranks the stored scan.
 */
export async function planPlatformRepair(
  pool: Pick<Pool, 'query'>,
  fresh: Map<number, DocumentPlatform | null> = new Map(),
): Promise<PlatformRepairPlan> {
  const [rows] = await pool.query<RuleRow[]>(
    `SELECT r.blog_id AS blogId,b.slug,r.platform,s.detections,s.status AS scanStatus
       FROM content_blog_rules r JOIN blogs b ON b.id=r.blog_id AND b.status='verified'
       LEFT JOIN blog_tech_scans s ON s.blog_id=r.blog_id AND s.status='detected'
      WHERE r.rule_source='inferred' ORDER BY r.blog_id`,
  );
  const plan: PlatformRepairPlan = { changes: [], unverified: [], confirmed: 0 };
  for (const row of rows) {
    const read = fresh.has(row.blogId) ? fresh.get(row.blogId) : undefined;
    const fromScan = row.scanStatus === 'detected' ? scanPlatform(row.detections) : null;
    const evidence = read ?? fromScan;
    if (!evidence) {
      // A WordPress guess is the one that was wrong before: list those that nothing confirms.
      if (row.platform === 'wordpress') plan.unverified.push({ blogId: row.blogId, slug: row.slug, platform: row.platform });
      continue;
    }
    if (evidence === row.platform) plan.confirmed++;
    else
      plan.changes.push({
        blogId: row.blogId,
        slug: row.slug,
        from: row.platform,
        to: evidence,
        evidence: read ? 'home-page' : 'technology-scan',
      });
  }
  return plan;
}

/** Applies a plan; `backup` receives the rows being changed (as they are now) before anything is written. */
export async function applyPlatformRepair(
  pool: Pick<Pool, 'execute'>,
  plan: PlatformRepairPlan,
  backup: (changes: PlatformChange[]) => Promise<void> | void,
  now: Date = new Date(),
) {
  await backup(plan.changes);
  let changed = 0;
  for (const change of plan.changes) {
    // The guard keeps a rule that was edited or corrected since the preview.
    const [result] = await pool.execute(
      `UPDATE content_blog_rules SET platform=?,adapter_id=?,rule_revision=rule_revision+1,updated_at=?
        WHERE blog_id=? AND rule_source='inferred' AND platform=?`,
      [change.to, `${change.to}-public`, now, change.blogId, change.from],
    );
    changed += (result as { affectedRows?: number }).affectedRows ?? 0;
  }
  return changed;
}
