// Sidebar section in the SourceProfile 部落格資料 style (tag /media/[media]/ sidebar, afe0a65), beside
// BlogContentSources. Rendered only while BLOG_TECH_PUBLIC_ENABLED is on: app/blogs/[slug]/page.tsx decides.
// Only what was recognized is shown; with nothing recognized the section is left out. How it is observed lives in
// the footer's 部落格頁 block and /tech/'s 資料來源與計算方式, not here.
import Link from '@/components/NoPrefetchLink';
import ReloadButton from '@/components/public/ReloadButton';
import { taipei } from '@/lib/api';
import { isPageKey } from '@/lib/page-links';
import { publicJsonOrNull } from '@/lib/public-api';
import { PublicGatewayError } from '@/lib/public-read';
import {
  type BlogTechPayload,
  blogTechApiPath,
  categoryText,
  confidenceLabel,
  errorLabel,
  evidenceKindText,
  externalHref,
  isHistorical,
  isInfra,
  shownVersion,
  statusText,
  type TechDetection,
  type TechEvidence,
  techHref,
} from '@/lib/tech';

const box = 'rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800';
const muted = 'text-zinc-600 dark:text-zinc-400';
const link = 'text-brand-700 hover:underline dark:text-brand-400';

/** Evidence carries no id; its kind and value are all it says, so they are its key, whatever the order sent. */
export const techEvidenceKey = (evidence: TechEvidence) => JSON.stringify([evidence.kind, evidence.value]);
/** The same kind and value sent twice says nothing more: listed once. */
export function distinctTechEvidence(evidence: TechEvidence[]) {
  return [...new Map(evidence.map((item) => [techEvidenceKey(item), item])).entries()];
}

function Detection({ detection }: { detection: TechDetection }) {
  const version = shownVersion(detection);
  return (
    <li className="border-t border-zinc-200 pt-2 first:border-t-0 first:pt-0 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={techHref({ technology: detection.id })}
          className={`inline-flex min-h-11 min-w-0 items-center font-medium ${link}`}
          title={`看其他保留證據中有 ${detection.name} 的部落格`}
        >
          <span className="truncate">{detection.name}</span>
        </Link>
        <span className={`shrink-0 text-[11px] ${muted}`}>{categoryText[detection.category] ?? detection.category}</span>
      </div>
      <dl className="mt-1 grid grid-cols-[4rem_minmax(0,1fr)] gap-y-1 leading-5">
        {version && (
          <>
            <dt className={muted}>版本</dt>
            <dd className="tabular-nums">{version}</dd>
          </>
        )}
        <dt className={muted}>信心</dt>
        <dd>{confidenceLabel(detection.confidence)}</dd>
        <dt className={muted}>規則</dt>
        <dd className="break-all font-mono text-[11px]">{detection.ruleId}</dd>
        {detection.evidence.length > 0 && (
          <>
            <dt className={muted}>證據</dt>
            <dd>
              <ul className="space-y-0.5">
                {distinctTechEvidence(detection.evidence).map(([key, evidence]) => (
                  <li key={key} className="break-all">
                    <span className={muted}>{evidenceKindText[evidence.kind] ?? evidence.kind}：</span>
                    <code className="font-mono text-[11px]">{evidence.value}</code>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {detection.observedAt && (
          <>
            <dt className={muted}>觀測於</dt>
            <dd className="tabular-nums">{taipei(detection.observedAt)}</dd>
          </>
        )}
      </dl>
    </li>
  );
}

/** The section's frame; `children` is whatever this request's answer allows it to say. */
function Section({ children, state }: { children: React.ReactNode; state?: React.ReactNode }) {
  return (
    <section id="tech" className={box}>
      <h2 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold">
        使用的技術
        {state}
      </h2>
      {children}
    </section>
  );
}

/** Shown while the section's own read is in flight, so a slow gateway never holds back the rest of the profile. */
export function BlogTechPending() {
  return (
    <Section>
      <p aria-busy="true" className={`leading-5 ${muted}`}>
        正在讀取技術觀測…
      </p>
    </Section>
  );
}

export default async function BlogTech({ slug }: { slug: string }) {
  // null: the gateway's 404 (its own switch off, or no such public blog), or a slug the route answers 400 to.
  // A gateway failure (5xx, network, a 200 public-contracts.ts rejects) stays inside this optional section:
  // it says so with a retry, never shows a guess or an earlier answer, and the rest of the profile renders.
  // Anything else (Next's own control flow included) is rethrown untouched.
  let data: BlogTechPayload | null = null;
  let unavailable = false;
  if (isPageKey('blog', slug)) {
    try {
      data = await publicJsonOrNull<BlogTechPayload>(blogTechApiPath(slug));
    } catch (error) {
      if (!(error instanceof PublicGatewayError)) throw error;
      unavailable = true;
    }
  }
  if (unavailable)
    return (
      <Section>
        <div role="alert" className={`leading-5 ${muted}`}>
          <p>技術資料暫時無法讀取，請稍後再試。</p>
          <ReloadButton />
        </div>
      </Section>
    );
  if (!data?.blog.detections.length) return null;
  const { blog } = data;
  const historical = isHistorical(blog);
  const failed = blog.status === 'failed' || blog.status === 'blocked';
  const software = blog.detections.filter((d) => !isInfra(d.category));
  const infra = blog.detections.filter((d) => isInfra(d.category));
  const evidenceSource = externalHref(blog.evidenceSourceUrl);
  return (
    <Section>
      <dl className="mt-1 grid grid-cols-[5rem_minmax(0,1fr)] gap-y-2.5 leading-5">
        {failed && (
          <>
            <dt className={muted}>最近一次</dt>
            <dd>
              {statusText[blog.status]} · {errorLabel(blog.errorCode)}
            </dd>
          </>
        )}
        {blog.observedAt && (
          <>
            <dt className={muted}>成功觀測</dt>
            <dd className="tabular-nums">{taipei(blog.observedAt)}</dd>
          </>
        )}
        {evidenceSource && (
          <>
            <dt className={muted}>觀測來源</dt>
            <dd className="break-all">
              <a className={link} href={evidenceSource} rel="noopener noreferrer">
                {evidenceSource} ↗
              </a>
            </dd>
          </>
        )}
      </dl>
      {blog.sourceUrl && (
        <p className="mt-3">
          <a
            className={link}
            href={`https://traffic.observe.tw/tech/${encodeURIComponent(new URL(blog.sourceUrl).hostname.toLowerCase().replace(/^www\./, ''))}/`}
            rel="noopener noreferrer"
          >
            在 traffic 查看詳細結果 ↗
          </a>
        </p>
      )}
      {software.length > 0 && (
        <>
          <h3 className={`mt-3 mb-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-800 ${muted}`}>
            {historical ? '上次成功辨識到的網站軟體' : '辨識到的網站軟體'}
          </h3>
          <ul className="space-y-2">
            {software.map((detection) => (
              <Detection key={detection.id} detection={detection} />
            ))}
          </ul>
        </>
      )}
      {infra.length > 0 && (
        <>
          <h3 className={`mt-3 mb-1 border-t border-zinc-200 pt-3 dark:border-zinc-800 ${muted}`}>
            {historical ? '上次成功辨識到的主機與 CDN（低信心）' : '主機與 CDN（低信心）'}
          </h3>
          <ul className="space-y-2">
            {infra.map((detection) => (
              <Detection key={detection.id} detection={detection} />
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
