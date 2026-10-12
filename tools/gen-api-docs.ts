/** Adapted from tag.observe.tw afe0a65 tools/gen-api-docs.ts; see LICENSE / NOTICE. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API_INTRO, API_TAGS, buildOpenApi, ENDPOINTS, examplePath, type Schema } from '../app/src/v1/openapi.ts';

const ORIGIN = 'https://blog.observe.tw';
const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (headers: string[], rows: string[][]) =>
  [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
const anchor = (path: string) =>
  path
    .replace(/^\/api\/v1\/?/, 'api-v1-')
    .replace(/[{}]/g, '')
    .replace(/[/.]/g, '-');
const schemas = buildOpenApi().components.schemas;
function resolve(schema: Schema): Schema {
  if (typeof schema.$ref === 'string') return resolve(schemas[schema.$ref.split('/').at(-1)!]);
  if (Array.isArray(schema.allOf)) {
    const parts = (schema.allOf as Schema[]).map(resolve);
    return {
      type: 'object',
      properties: Object.assign({}, ...parts.map((part) => part.properties)),
      required: parts.flatMap((part) => (part.required as string[]) ?? []),
    };
  }
  return schema;
}
function typeLabel(schema: Schema): string {
  const value = resolve(schema);
  if (Array.isArray(value.enum)) return value.enum.map((item) => JSON.stringify(item)).join(' | ');
  return [value.type ?? 'object']
    .flat()
    .map((type) =>
      type === 'array'
        ? `${typeLabel((value.items as Schema) ?? {})}[]`
        : type === 'string' && value.format === 'date-time'
          ? 'string (ISO 時間)'
          : String(type),
    )
    .join(' | ');
}
function fields(schema: Schema, prefix = ''): string[][] {
  const value = resolve(schema);
  if (!value.properties) return [];
  return Object.entries(value.properties as Record<string, Schema>).flatMap(([key, child]) => {
    const full = prefix ? `${prefix}.${key}` : key,
      resolved = resolve(child);
    const nested = resolved.items ? fields(resolved.items as Schema, `${full}[]`) : fields(resolved, full);
    return [[`\`${full}\``, typeLabel(resolved), String(resolved.description ?? '')], ...nested];
  });
}
export function renderApiMarkdown() {
  const out = [
    `# ${API_INTRO.title}`,
    '',
    '本文件由 `tools/gen-api-docs.ts` 依 `app/src/v1/openapi.ts` 產生，請勿手改。',
    '',
    API_INTRO.summary,
    '',
    `網站文件：<${ORIGIN}/api/>；機器可讀規格：<${ORIGIN}/api/v1/openapi.json>；API 狀態：<${ORIGIN}/api/status>。`,
    '',
    '## 使用規則',
    '',
    ...API_INTRO.rules.map((rule) => `- ${rule}`),
    '',
    '## 快速開始',
    '',
  ];
  for (const example of API_INTRO.quickstart) out.push(`### ${example.label}`, '', `\`\`\`${example.lang}`, example.code, '```', '');
  out.push(
    '## 端點一覽',
    '',
    table(
      ['端點', '說明'],
      ENDPOINTS.map((endpoint) => [`[\`GET ${endpoint.path}\`](#${anchor(endpoint.path)})`, endpoint.summary]),
    ),
    '',
  );
  for (const tag of API_TAGS) {
    out.push(`## ${tag.description}`, '');
    for (const endpoint of ENDPOINTS.filter((item) => item.tag === tag.name)) {
      out.push(`<a id="${anchor(endpoint.path)}"></a>`, '', `### \`GET ${endpoint.path}\``, '', `**${endpoint.summary}**`, '');
      if (endpoint.description) out.push(endpoint.description, '');
      if (endpoint.params?.length)
        out.push(
          table(
            ['參數', '位置', '型別', '說明'],
            endpoint.params.map((param) => [
              param.name,
              param.in === 'path' ? '路徑' : 'query',
              typeLabel(param.schema),
              `${param.description}${param.schema.default !== undefined ? `；預設 ${param.schema.default}` : ''}${param.schema.minimum !== undefined ? `；${param.schema.minimum}–${param.schema.maximum}` : ''}`,
            ]),
          ),
          '',
        );
      out.push(
        '範例：',
        '',
        '```sh',
        `curl --fail-with-body -sS '${ORIGIN}${examplePath(endpoint)}'`,
        '```',
        '',
        '回應欄位：',
        '',
        table(['欄位', '型別', '說明'], fields(endpoint.response)),
        '',
      );
      out.push(
        `錯誤：${Object.entries(endpoint.errors ?? {})
          .map(([code, description]) => `\`${code}\` ${description}`)
          .join('；')}。`,
        '',
        `快取：\`${endpoint.cache}\`（僅匿名成功回應）。`,
        '',
      );
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}
export function renderOpenApiJson() {
  return `${JSON.stringify(buildOpenApi(), null, 2)}\n`;
}
export function generateApiDocs(check = false) {
  const outputs = [
    [new URL('../docs/api.md', import.meta.url), renderApiMarkdown()],
    [new URL('../data/openapi.json', import.meta.url), renderOpenApiJson()],
  ] as const;
  for (const [path, content] of outputs) {
    if (check) {
      let current = '';
      try {
        current = readFileSync(path, 'utf8');
      } catch {
        /* Missing generated output is drift too. */
      }
      if (current !== content) throw Error(`${fileURLToPath(path)} is out of date; run node tools/gen-api-docs.ts`);
    } else {
      mkdirSync(new URL('.', path), { recursive: true });
      writeFileSync(path, content);
    }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateApiDocs(process.argv.includes('--check'));
  console.log(process.argv.includes('--check') ? 'API generated artifacts are current' : 'wrote docs/api.md and data/openapi.json');
}
