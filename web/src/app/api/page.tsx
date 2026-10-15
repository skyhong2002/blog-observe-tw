// Adapted from tag.observe.tw afe0a65 (web/src/app/(site)/api/page.tsx), MIT, Copyright (c) 2026 Sky Hong.
// Human-readable API docs, rendered at build time from the backend generator's
// data/openapi.json so this page never drifts from the endpoints.
import ApiTabs from '@/components/ApiTabs';
import PageOutline, { type OutlineEntry } from '@/components/PageOutline';
import TableScroller from '@/components/TableScroller';
import { type Schema, schemaTools } from '@/lib/openapi-fields.mts';
import {
  endpointAnchor,
  exampleUrl,
  fullPath,
  GITHUB_DOC,
  loadSpec,
  type OperationEntry,
  operations,
  SITE_ORIGIN,
} from '@/lib/openapi-spec';
import { staticPageMetadata } from '@/lib/seo';
import { table } from '@/lib/table-styles';

export const dynamic = 'force-static';
export const metadata = staticPageMetadata('/api/');

// `code` spans in the spec's prose become <code>.
// Table cells pass `nowrap` so their row stays on one line.
function Prose({ text, nowrap = false }: { text: string; nowrap?: boolean }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i, parts) =>
        part.startsWith('`') && part.endsWith('`') ? (
          <code
            // Text before this span plus the span itself: unique and stable for a fixed string.
            key={parts.slice(0, i + 1).join('')}
            // anywhere, not break-all: short tokens (`status`, `x-api-key`) move whole to the
            // next line; only a token wider than the column is split.
            className={`${nowrap ? 'whitespace-nowrap' : '[overflow-wrap:anywhere] whitespace-normal'} rounded bg-zinc-100 px-1 py-0.5 text-[0.85em] dark:bg-zinc-800`}
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

const h2Class = 'scroll-mt-24 text-lg font-semibold';
const headClass = 'bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400';
const typeCell = `${table.cell} font-mono text-xs text-zinc-600 dark:text-zinc-400`;
/** One line per row: long descriptions truncate, the full text is on hover. */
function DescCell({ text }: { text: string }) {
  return (
    <td className={`${table.cell} whitespace-nowrap`}>
      <span className="block max-w-[28rem] truncate" title={text.replace(/`/g, '')}>
        {text && <Prose text={text} nowrap />}
      </span>
    </td>
  );
}
const linkClass = 'text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-600 dark:text-brand-400';
const pillClass = 'rounded-full border border-zinc-300 px-3 py-1 hover:border-brand-400 dark:border-zinc-700';

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 text-[13px] leading-relaxed text-zinc-100 dark:bg-zinc-900/80">
      <code>{code}</code>
    </pre>
  );
}

/** Sticky, single-line first cell: names stay readable while the table scrolls sideways. */
function Lead({ text, extra }: { text: string; extra?: string }) {
  return (
    <td className={table.lead}>
      <div className={`${table.leadBox} flex items-baseline gap-1`}>
        <span className={`${table.leadText} block font-mono text-[13px] sm:max-w-72`} title={text}>
          {text}
        </span>
        {extra && <span className={`${table.leadExtra} shrink-0 text-xs text-zinc-500`}>{extra}</span>}
      </div>
    </td>
  );
}

function TypeCell({ label }: { label: string }) {
  return (
    <td className={typeCell}>
      <span className="block max-w-56 truncate" title={label}>
        {label}
      </span>
    </td>
  );
}

function Endpoint({ entry, tools }: { entry: OperationEntry; tools: ReturnType<typeof schemaTools> }) {
  const { path, method, op } = entry;
  const responses = op.responses ?? {};
  const successCode = Object.keys(responses).find((code) => code.startsWith('2')) ?? '200';
  const success = responses[successCode];
  const ok = success?.content?.['application/json']?.schema ?? Object.values(success?.content ?? {})[0]?.schema;
  const variants = ok?.oneOf ?? (ok ? [ok] : []);
  const errors = Object.entries(responses).filter(([code]) => code !== successCode && code !== '429');
  const params = (op.parameters ?? []).filter((p) => p.in === 'path' || p.in === 'query');
  const example = exampleUrl(entry);
  const exampleHref = example && !/^https?:/.test(example) ? `${SITE_ORIGIN}${example}` : example;
  return (
    <section id={endpointAnchor(method, path)} className="scroll-mt-24 border-t border-zinc-300 pt-5 dark:border-zinc-800">
      <h3 className="flex flex-wrap items-baseline gap-2 font-mono text-[15px]">
        <span className="rounded bg-brand-100 px-1.5 py-0.5 text-xs font-semibold text-brand-800 dark:bg-brand-900/50 dark:text-brand-300">
          {method}
        </span>
        {entry.head && (
          <span
            title="也接受 HEAD：同樣的參數與回應標頭，不含本文"
            className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          >
            HEAD
          </span>
        )}
        <span className="break-all font-semibold">{path}</span>
      </h3>
      {op.summary && <p className="mt-1 font-medium">{op.summary}</p>}
      {op.description && (
        <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <Prose text={op.description} />
        </p>
      )}
      {params.length > 0 && (
        <TableScroller card label={`${method} ${path} 參數表格，可左右捲動`} className="mt-3">
          <table className="w-full min-w-[34rem] whitespace-nowrap text-sm">
            <thead className={headClass}>
              <tr>
                <th scope="col" className={table.leadHead}>
                  參數
                </th>
                <th scope="col" className={table.cell}>
                  型別
                </th>
                <th scope="col" className={table.cell}>
                  說明
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {params.map((p) => {
                const s: Schema = p.schema ?? {};
                return (
                  <tr key={`${p.in}:${p.name}`} className={table.row}>
                    <Lead text={p.name} extra={p.in === 'path' ? '路徑' : p.required ? '必填' : undefined} />
                    <TypeCell label={tools.typeLabel(s)} />
                    <DescCell
                      text={[
                        p.description ?? '',
                        s.minimum !== undefined && s.maximum !== undefined ? `${s.minimum}–${s.maximum}` : '',
                        s.default !== undefined ? `預設 \`${String(s.default)}\`` : '',
                      ]
                        .filter(Boolean)
                        .join('，')}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      )}
      {exampleHref && (
        <div className="mt-3 space-y-1">
          <CodeBlock code={method === 'GET' ? `curl -s '${exampleHref}'` : `curl -s -X ${method} '${exampleHref}'`} />
          {method === 'GET' && (
            <a href={exampleHref} target="_blank" rel="noopener" className={`text-sm ${linkClass}`}>
              在瀏覽器開啟這個範例 ↗
            </a>
          )}
        </div>
      )}
      {variants.map((v, i) => {
        const rows = tools.fieldRows(v);
        if (!rows.length) return null;
        const label = variants.length > 1 ? `回應欄位（${tools.merge(v).description ?? `格式 ${i + 1}`}）` : '回應欄位';
        return (
          <details key={label} className="mt-3 rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              {label}
              <span className="ml-2 text-xs font-normal text-zinc-500">{rows.length} 個</span>
            </summary>
            <TableScroller label={`${label}表格，可左右捲動`} className="border-t border-zinc-200 dark:border-zinc-800">
              <table className="w-full min-w-[34rem] whitespace-nowrap text-sm">
                <thead className={headClass}>
                  <tr>
                    <th scope="col" className={table.leadHead}>
                      欄位
                    </th>
                    <th scope="col" className={table.cell}>
                      型別
                    </th>
                    <th scope="col" className={table.cell}>
                      說明
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {rows.map((r) => (
                    <tr key={r.field} className={table.row}>
                      <Lead text={r.field} />
                      <TypeCell label={r.type} />
                      <DescCell text={r.description} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroller>
          </details>
        );
      })}
      {errors.length > 0 && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          錯誤：
          {errors.map(([code, r], i) => (
            <span key={code}>
              {i > 0 && '；'}
              <code className="font-mono">{code}</code> {r.description && <Prose text={r.description} />}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

export default function ApiDocsPage() {
  const spec = loadSpec();
  const tools = schemaTools(spec.components?.schemas ?? {});
  const ops = operations(spec);
  const lines = (spec.info.description ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const quickstarts = spec.info['x-quickstart'] ?? [];
  const tagged = (spec.tags ?? [])
    .map((tag) => ({
      id: `tag-${tag.name.replace(/\s+/g, '-')}`,
      title: tag.description || tag.name,
      list: ops.filter(({ op }) => op.tags?.includes(tag.name)),
    }))
    .filter(({ list }) => list.length > 0);
  const rest = ops.filter(({ op }) => !tagged.some(({ list }) => list.some((e) => e.op === op)));
  const groups = rest.length ? [...tagged, { id: 'tag-other', title: tagged.length ? '其他端點' : '端點說明', list: rest }] : tagged;
  // The spec's own JSON, when the gateway lists it among its paths.
  const specPath = Object.keys(spec.paths)
    .map((p) => fullPath(spec, p))
    .find((p) => p.endsWith('openapi.json'));
  // The outline lists each group's endpoints by path (without /api/v1), the summary on hover.
  const outline: OutlineEntry[] = [
    ...(lines.length ? [{ id: 'rules', title: '使用規則' }] : []),
    ...(quickstarts.length ? [{ id: 'quickstart', title: '快速開始' }] : []),
    { id: 'endpoints', title: '端點一覽' },
    ...groups.map(({ id, title, list }) => ({
      id,
      title,
      children: list.map(({ path, method, op }) => ({
        id: endpointAnchor(method, path),
        title: `${method} ${path.replace(/^\/api\/v1(?=\/)/, '')}`,
        hint: op.summary,
        mono: true,
      })),
    })),
  ];
  return (
    <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_13rem] lg:gap-x-12 lg:gap-y-6 lg:space-y-0">
      <div className="lg:col-span-2">
        <ApiTabs current="docs" />
      </div>
      <div className="min-w-0 space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{spec.info.title}</h1>
          {spec.info.summary && <p className="text-zinc-700 dark:text-zinc-300">{spec.info.summary}</p>}
          <div className="flex flex-wrap gap-2 pt-1 text-sm">
            {specPath && (
              <a href={specPath} className={pillClass}>
                OpenAPI 規格
              </a>
            )}
            <a href={GITHUB_DOC} className={pillClass}>
              Markdown 版文件
            </a>
            <a href="/my/#api-keys" className={pillClass}>
              管理 API 金鑰
            </a>
          </div>
        </header>

        {lines.length > 0 && (
          <section className="space-y-2">
            <h2 id="rules" className={h2Class}>
              使用規則
            </h2>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
              {lines.map((r) => (
                <li key={r}>
                  <Prose text={r.replace(/^[-*] /, '')} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {quickstarts.length > 0 && (
          <section className="space-y-3">
            <h2 id="quickstart" className={h2Class}>
              快速開始
            </h2>
            {quickstarts.map((q) => (
              <div key={q.label} className="space-y-1">
                <p className="text-sm font-medium">{q.label}</p>
                <CodeBlock code={q.code} />
              </div>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <h2 id="endpoints" className={h2Class}>
            端點一覽
          </h2>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {ops.map(({ path, method, op }) => (
              <li key={`${method}:${path}`} className="flex min-w-0 gap-2">
                <a
                  href={`#${endpointAnchor(method, path)}`}
                  className={`min-w-0 shrink truncate font-mono ${linkClass}`}
                  title={`${method} ${path}`}
                >
                  {method} {path}
                </a>
                {op.summary && (
                  <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-400" title={op.summary}>
                    {op.summary}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {groups.map(({ id, title, list }) => (
          <section key={id} className="space-y-5">
            <h2 id={id} className={h2Class}>
              {title}
            </h2>
            {list.map((entry) => (
              <Endpoint key={`${entry.method}:${entry.path}`} entry={entry} tools={tools} />
            ))}
          </section>
        ))}
      </div>
      <PageOutline entries={outline} />
    </div>
  );
}
