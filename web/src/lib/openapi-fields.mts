// Adapted from tag.observe.tw afe0a65 (web/src/lib/openapi-fields.mts), MIT,
// Copyright (c) 2026 Sky Hong. Adds `example` to Schema for request examples.
// Turns OpenAPI response schemas into readable field lists for the /api/ docs
// page; no imports so other tooling can load it directly.

export type Schema = {
  type?: string | string[];
  $ref?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  prefixItems?: Schema[];
  additionalProperties?: Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  enum?: unknown[];
  format?: string;
  default?: unknown;
  example?: unknown;
  minimum?: number;
  maximum?: number;
};
export interface FieldRow {
  field: string;
  type: string;
  description: string;
}

export function schemaTools(schemas: Record<string, Schema>) {
  const resolve = (s: Schema): Schema =>
    s.$ref ? { ...resolve(schemas[s.$ref.split('/').pop() as string] ?? {}), ...(s.description ? { description: s.description } : {}) } : s;
  const merge = (s: Schema): Schema => {
    const r = resolve(s);
    if (!r.allOf) return r;
    const parts = r.allOf.map(merge);
    return {
      type: 'object',
      properties: Object.assign({}, ...parts.map((x) => x.properties)),
      required: parts.flatMap((x) => x.required ?? []),
    };
  };
  const hasFields = (s: Schema) => {
    const r = merge(s);
    return !!(r.properties || (r.additionalProperties && merge(r.additionalProperties).properties));
  };

  function typeLabel(s0: Schema): string {
    const s = merge(s0);
    const types = [s.type ?? 'object'].flat();
    let label = types
      .filter((t) => t !== 'null')
      .map((t) => {
        if (t === 'array') return s.prefixItems ? `[${s.prefixItems.map(typeLabel).join(', ')}]` : `${typeLabel(s.items ?? {})}[]`;
        if (t === 'object' && s.additionalProperties && !s.properties) return `{鍵: ${typeLabel(s.additionalProperties)}}`;
        if (s.format === 'date-time') return 'string (ISO 時間)';
        return t;
      })
      .join(' | ');
    if (s.enum) label = s.enum.map((v) => JSON.stringify(v)).join(' | ');
    return types.includes('null') ? `${label} | null` : label;
  }

  /** Flattens a schema into rows such as `entries[].media`. */
  function fieldRows(s0: Schema, prefix = ''): FieldRow[] {
    const s = merge(s0);
    const types = [s.type ?? 'object'].flat();
    if (types.includes('array') && s.items && !s.prefixItems) return hasFields(s.items) ? fieldRows(s.items, `${prefix}[]`) : [];
    if (!s.properties)
      return s.additionalProperties && hasFields(s.additionalProperties) ? fieldRows(s.additionalProperties, `${prefix}{鍵}`) : [];
    const rows: FieldRow[] = [];
    for (const [k, v] of Object.entries(s.properties)) {
      const field = prefix ? `${prefix}.${k}` : k;
      const r = merge(v);
      rows.push({ field, type: typeLabel(v), description: r.description ?? '' });
      const rt = [r.type ?? 'object'].flat();
      if (r.properties) rows.push(...fieldRows(r, field));
      else if (rt.includes('array') && r.items && hasFields(r.items)) rows.push(...fieldRows(r, field));
      else if (r.additionalProperties && hasFields(r.additionalProperties))
        rows.push(...fieldRows(r.additionalProperties, `${field}.{鍵}`));
    }
    return rows;
  }

  return { merge, typeLabel, fieldRows };
}
