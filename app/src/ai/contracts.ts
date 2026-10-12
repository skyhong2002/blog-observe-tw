import { createHash } from 'node:crypto';
import { ownershipQuotes, ownershipSegments } from './ownership.ts';
export const AI_POLICY = 'personal-blog-v2-ownership';
export const NORMALIZATION = 'plain-nfkc-v1';
export const MODEL_ALIAS = 'sky-quality';
export type AiTask = 'classification' | 'profile' | 'topics';
export type AiResult = {
  classification: 'personal' | 'organization' | 'media' | 'shop' | 'uncertain';
  confidence: number;
  quotedEvidence: string[];
  bio: string;
  topics: string[];
};
export function normalizeInput(input: string) {
  const clean = input.normalize('NFKC').replace(/\r\n?/g, '\n');
  let out = '';
  let bytes = 0;
  for (const char of clean) {
    if (char.charCodeAt(0) < 32 && char !== '\n' && char !== '\t') continue;
    bytes += Buffer.byteLength(char);
    if (bytes > 12000) break;
    out += char;
  }
  return out;
}
export function inputKey(task: AiTask, input: string) {
  const inputHash = createHash('sha256').update(input).digest('hex');
  return {
    inputHash,
    cacheKey: createHash('sha256').update([task, AI_POLICY, NORMALIZATION, MODEL_ALIAS, inputHash].join('\0')).digest('hex'),
  };
}
export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['classification', 'confidence', 'quotedEvidence', 'bio', 'topics'],
  properties: {
    classification: { type: 'string', enum: ['personal', 'organization', 'media', 'shop', 'uncertain'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    quotedEvidence: { type: 'array', maxItems: 5, items: { type: 'string', minLength: 8, maxLength: 300 } },
    bio: { type: 'string', maxLength: 600 },
    topics: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 60 } },
  },
};
export function validateResult(value: unknown, input: string): AiResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_output');
  const v = value as AiResult;
  if (
    Object.keys(v).sort().join() !== ['bio', 'classification', 'confidence', 'quotedEvidence', 'topics'].sort().join() ||
    !['personal', 'organization', 'media', 'shop', 'uncertain'].includes(v.classification) ||
    typeof v.confidence !== 'number' ||
    !Number.isFinite(v.confidence) ||
    v.confidence < 0 ||
    v.confidence > 1 ||
    typeof v.bio !== 'string' ||
    v.bio.length > 600 ||
    !Array.isArray(v.quotedEvidence) ||
    v.quotedEvidence.length > 5 ||
    v.quotedEvidence.some((q) => typeof q !== 'string' || q.trim().length < 8 || q.length > 300 || !input.includes(q)) ||
    !Array.isArray(v.topics) ||
    v.topics.length > 8 ||
    v.topics.some((t) => typeof t !== 'string' || !t.trim() || t.length > 60)
  )
    throw Error('invalid_output');
  if (v.classification !== 'uncertain' && !v.quotedEvidence.length) throw Error('ungrounded_output');
  return v;
}
/** Operator edits still obey the public schema; only their grounded factual responsibility differs. */
export function validatedOverride(value: unknown): AiResult | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return validateResult(parsed, Array.isArray(parsed?.quotedEvidence) ? parsed.quotedEvidence.join('\n') : '');
  } catch {
    return null;
  }
}

/** Classification evidence is confined to separate site-level excerpts, never labels or article/comment content. */
export function validateInference(task: AiTask, value: unknown, input: string): AiResult {
  if (task !== 'classification') return validateResult(value, input);
  const segments = ownershipSegments(input);
  if (!segments) throw Error('invalid_output');
  const result = validateResult(value, segments.join('\n'));
  if (result.quotedEvidence.some((q) => !segments.some((s) => s.includes(q)))) throw Error('ungrounded_output');
  if (result.classification === 'personal' && !ownershipQuotes(input, result.quotedEvidence)) {
    return { classification: 'uncertain', confidence: 0, quotedEvidence: [], bio: '', topics: [] };
  }
  return result;
}
