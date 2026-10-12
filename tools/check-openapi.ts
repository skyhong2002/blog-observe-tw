/** Read-only public response check, following tag.observe.tw's check-openapi convention. */
import { fileURLToPath } from 'node:url';
import { buildOpenApi, type Schema } from '../app/src/v1/openapi.ts';

const schemas = buildOpenApi().components.schemas;
/** Validates the JSON Schema subset emitted by our spec, with paths for actionable drift reports. */
export function schemaErrors(value: unknown, schema: Schema, path = '$'): string[] {
  if (typeof schema.$ref === 'string') return schemaErrors(value, schemas[schema.$ref.split('/').at(-1)!], path);
  if (Array.isArray(schema.allOf)) return (schema.allOf as Schema[]).flatMap((part) => schemaErrors(value, part, path));
  const types = [schema.type].flat().filter(Boolean);
  const matches = (type: unknown) =>
    type === 'null'
      ? value === null
      : type === 'array'
        ? Array.isArray(value)
        : type === 'object'
          ? value !== null && typeof value === 'object' && !Array.isArray(value)
          : type === 'integer'
            ? typeof value === 'number' && Number.isInteger(value)
            : typeof value === type;
  if (types.length && !types.some(matches)) return [`${path}: expected ${types.join('|')}, got ${value === null ? 'null' : typeof value}`];
  if (value === null) return [];
  const errors: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path}: outside enum`);
  if ('const' in schema && schema.const !== value) errors.push(`${path}: differs from const`);
  if (typeof value === 'string') {
    if (
      schema.format === 'date-time' &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value)))
    )
      errors.push(`${path}: expected UTC ISO timestamp`);
    if (typeof schema.maxLength === 'number' && Array.from(value).length > schema.maxLength) errors.push(`${path}: exceeds maxLength`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${path}: exceeds maxItems`);
    if (schema.items)
      for (const [index, item] of value.entries()) errors.push(...schemaErrors(item, schema.items as Schema, `${path}[${index}]`));
  } else if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    for (const required of (schema.required as string[]) ?? [])
      if (!(required in row)) errors.push(`${path}.${required}: missing required field`);
    for (const [key, child] of Object.entries((schema.properties as Record<string, Schema>) ?? {}))
      if (key in row) errors.push(...schemaErrors(row[key], child, `${path}.${key}`));
  }
  return errors;
}
export async function checkOpenApi(origin: string) {
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw Error('Pass a plain HTTP(S) origin without credentials or query');
  const specification = buildOpenApi();
  let requests = 0;
  const read = async (path: string, template = path.split('?')[0]) => {
    if (requests++) await new Promise((resolve) => setTimeout(resolve, 1100));
    const response = await fetch(new URL(path, base), {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
    const value = await response.json();
    const operation = specification.paths[template];
    if (!operation) throw Error(`Unspecified route: ${template}`);
    const errors = schemaErrors(value, operation.get.responses['200'].content['application/json'].schema);
    if (errors.length) throw Error(`${path}:\n${errors.slice(0, 30).join('\n')}`);
    console.log(`PASS ${template}`);
    return value;
  };
  await read('/api/v1/openapi.json');
  await read('/api/v1/articles?limit=5');
  const blogs = (await read('/api/v1/blogs?limit=5')) as { items: { slug: string }[] };
  if (blogs.items[0]) {
    const slug = encodeURIComponent(blogs.items[0].slug);
    await read(`/api/v1/blogs/${slug}`, '/api/v1/blogs/{slug}');
    await read(`/api/v1/blogs/${slug}/articles?limit=5`, '/api/v1/blogs/{slug}/articles');
    await read(`/api/v1/blogs/${slug}/relations`, '/api/v1/blogs/{slug}/relations');
  } else console.log('SKIP profile samples: no verified blogs');
  await read('/api/v1/relations');
  const topics = (await read('/api/v1/topics?limit=5')) as { items: { id: string }[] };
  if (topics.items[0]) await read(`/api/v1/topics/${encodeURIComponent(topics.items[0].id)}`, '/api/v1/topics/{id}');
  else console.log('SKIP topic detail sample: no ranked topics');
  return { requests };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await checkOpenApi(process.argv[2] ?? 'http://127.0.0.1:18160');
