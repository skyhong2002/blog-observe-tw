import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

// TypeScript 7's root export has no parser API. Reuse Next's lockfile-pinned Babel parser;
// this development audit requires both workspace dependencies, never installs another parser.
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { parse } = require('next/dist/compiled/babel/parser') as {
  parse: (source: string, options: { sourceType: string; plugins: string[] }) => AstNode;
};
type AstNode = { type?: string; value?: unknown; start?: number; end?: number; [key: string]: unknown };

const tables = new Set(['posts', 'blogs', 'content_post_bodies', 'relation_observations']);
const fixtureTools = new Set(['tools/test-integration.mjs', 'tools/test-visibility-barrier.mjs']);
const dml = /\b(?:insert(?:\s+ignore)?\s+into|replace\s+into|update|delete\s+from)\s+(?:`?[a-z_][\w]*`?\.)?`?([a-z_][\w]*)`?/gi;
const dynamic = /\b(?:insert(?:\s+ignore)?\s+into|replace\s+into|update|delete\s+from)\s+(?:\$\{|\?)/i;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const WRITER_AUDIT_VERSION = 'topic-writer-source-drift-v1';
export type WriterReference = { path: string; digest: string; tables: string[]; dynamic: boolean; occurrences: number };
export const writerAuditSource = (path: string) =>
  /^(?:app\/src|tools)\/[a-zA-Z0-9_./-]+\.(?:ts|js|mjs)$/.test(path) &&
  !/(?:^|\/)(?:test|tests|fixtures)(?:\/|$)|\.(?:spec|integration|test)\.(?:ts|js|mjs)$/.test(path) &&
  !fixtureTools.has(path);

/** Drift detection only: literal SQL is not proof of transaction/DB write admission. */
export function collectTopicWriters(path: string, source: string): WriterReference[] {
  if (!writerAuditSource(path) || typeof source !== 'string' || Buffer.byteLength(source) > 1024 * 1024) throw Error('writer-audit-input');
  let ast: AstNode;
  try {
    ast = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'importAttributes'] });
  } catch {
    throw Error('writer-audit-parse');
  }
  const found = new Map<string, WriterReference>();
  function inspect(text: string, forceDynamic = false) {
    const selected = [...new Set([...text.matchAll(dml)].map((m) => m[1].toLowerCase()).filter((t) => tables.has(t)))].sort();
    const unparsedTracked =
      !selected.length &&
      /\b(?:insert|replace|update|delete)\b/i.test(text) &&
      [...tables].some((t) => new RegExp(`\\b${t}\\b`, 'i').test(text));
    const unresolved =
      forceDynamic ||
      unparsedTracked ||
      dynamic.test(text) ||
      /\b(?:insert(?:\s+ignore)?\s+into|replace\s+into|update|delete\s+from)\s*$/i.test(text);
    if (!selected.length && !unresolved) return;
    const digest = sha(text),
      prior = found.get(digest);
    if (prior) prior.occurrences++;
    else found.set(digest, { path, digest, tables: selected, dynamic: unresolved, occurrences: 1 });
  }
  let visited = 0;
  function visit(node: AstNode) {
    if (++visited > 500000) throw Error('writer-audit-node-cap');
    if (node.type === 'StringLiteral' && typeof node.value === 'string') inspect(node.value);
    else if (node.type === 'TemplateLiteral') {
      const quasis = node.quasis as AstNode[];
      const expressions = node.expressions as AstNode[];
      // biome-ignore lint/suspicious/noTemplateCurlyInString: marker for source interpolation, never executable SQL.
      const text = quasis.map((q) => (q.value as { cooked?: string; raw: string }).cooked ?? (q.value as { raw: string }).raw).join('${?}');
      inspect(text, expressions.length > 0 && /\b(?:insert|replace|update|delete)\b/i.test(text));
    } else if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const callee = node.callee as AstNode;
      const property = callee?.property as AstNode;
      const name = property?.name ?? (property?.type === 'StringLiteral' ? property.value : undefined) ?? callee?.name;
      const arg = (node.arguments as AstNode[])?.[0];
      const unknownComputed = callee?.computed === true && property?.type !== 'StringLiteral';
      if (unknownComputed && arg) inspect(`computed-call:${source.slice(node.start, node.end)}`, true);
      else if (['query', 'execute'].includes(String(name)) && arg && !['StringLiteral', 'TemplateLiteral'].includes(String(arg.type)))
        inspect(`query-expression:${source.slice(arg.start, arg.end)}`, true);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object' && typeof child.type === 'string') visit(child);
      } else if (value && typeof value === 'object' && typeof (value as AstNode).type === 'string') visit(value as AstNode);
    }
  }
  visit(ast);
  return [...found.values()].sort((a, b) => a.digest.localeCompare(b.digest));
}

export async function auditTopicWriterTree(root: string) {
  const paths: string[] = [];
  let entries = 0,
    bytes = 0;
  async function walk(dir: string) {
    const directory = await lstat(dir);
    if (directory.isSymbolicLink() || !directory.isDirectory()) throw Error('writer-audit-directory');
    for (const name of await readdir(dir)) {
      if (++entries > 8192) throw Error('writer-audit-entry-cap');
      const absolute = join(dir, name),
        stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw Error('writer-audit-symlink');
      if (stat.isDirectory()) await walk(absolute);
      else if (stat.isFile() && writerAuditSource(relative(root, absolute))) paths.push(absolute);
    }
  }
  await walk(join(root, 'app/src'));
  await walk(join(root, 'tools'));
  const writers: WriterReference[] = [];
  for (const path of paths.sort()) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw Error('writer-audit-source-type');
    bytes += stat.size;
    if (stat.size > 1024 * 1024 || bytes > 64 * 1024 * 1024) throw Error('writer-audit-byte-cap');
    // Final-component symlink swaps fail at open; read bytes are bounded independently of lstat.
    // Parent directory adversaries are outside this audit: use an owned immutable pinned checkout.
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await fd.stat();
      if (!opened.isFile() || opened.size > 1024 * 1024) throw Error('writer-audit-source-type');
      if (['dev', 'ino', 'size', 'mtimeMs'].some((k) => stat[k as keyof typeof stat] !== opened[k as keyof typeof opened]))
        throw Error('writer-audit-source-changed');
      const buffer = Buffer.alloc(opened.size + 1);
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
      const after = await fd.stat();
      if (
        bytesRead !== opened.size ||
        ['dev', 'ino', 'size', 'mtimeMs'].some((k) => opened[k as keyof typeof opened] !== after[k as keyof typeof after])
      )
        throw Error('writer-audit-source-changed');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
      writers.push(...collectTopicWriters(relative(root, path), text));
    } finally {
      await fd.close();
    }
  }
  return { version: WRITER_AUDIT_VERSION, writers, canPublish: false as const, scope: 'literal-source-drift-only' as const };
}
