import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { auditTopicWriterTree } from './lib/topic-writer-audit.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const actual = await auditTopicWriterTree(root);
const expected = JSON.parse(await readFile(new URL('../data/topic-writer-registry.json', import.meta.url), 'utf8'));
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('topic-writer-registry-drift');
console.log(JSON.stringify({ passed: true, writers: actual.writers.length, scope: actual.scope, canPublish: false }));
