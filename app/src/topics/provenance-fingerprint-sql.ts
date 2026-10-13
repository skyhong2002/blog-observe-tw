import { types } from 'node:util';
export const TOPIC_FINGERPRINT_VERSION = 'topic-provenance-fingerprint-v1' as const;
export type FingerprintAliases = { post: 'p' | 'p2'; blog: 'b' | 'b2'; body: 'cb' | 'cb2' };
const defaults: FingerprintAliases = { post: 'p', blog: 'b', body: 'cb' };
function checkedAliases(input: unknown): FingerprintAliases {
  if (
    !input ||
    typeof input !== 'object' ||
    types.isProxy(input) ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    throw Error('invalid-fingerprint-aliases');
  const keys = ['post', 'blog', 'body'],
    ds = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).length !== 3 || keys.some((k) => !ds[k] || !('value' in ds[k]))) throw Error('invalid-fingerprint-aliases');
  for (const [key, allowed] of [
    ['post', ['p', 'p2']],
    ['blog', ['b', 'b2']],
    ['body', ['cb', 'cb2']],
  ] as const)
    if (typeof ds[key].value !== 'string' || !(allowed as readonly string[]).includes(ds[key].value))
      throw Error('invalid-fingerprint-aliases');
  return { post: ds.post.value, blog: ds.blog.value, body: ds.body.value };
}
const date = (column: string) => `DATE_FORMAT(${column},'%Y-%m-%dT%H:%i:%s.%fZ')`;
const textDigest = (column: string) => `SHA2(CONVERT(${column} USING utf8mb4),256)`;
const fingerprint = (domain: string, fields: string[]) => `SHA2(CONVERT(JSON_ARRAY('${domain}',${fields.join(',')}) USING utf8mb4),256)`;
/** Pure SQL fragments only; no proof of public ownership, UTC ingestion or complete body.
 * DATETIME must already be UTC by caller contract. OCTET_LENGTH may incur server I/O.
 * JSON_ARRAY still hashes an all-NULL tuple when LEFT JOIN cb is absent. Future callers must
 * require cb.post_id existence and a non-NULL expected hash plus fresh versions/ownership/public
 * and provenance gates. Metadata intentionally excludes b.status; verified/date/ownership are
 * separate statement-fresh predicates, never inferred from fingerprint equality.
 * Raw body is not hashed here: content_hash accuracy remains a cooperative-writer prerequisite.
 */
export function topicFingerprintSql(
  input?: FingerprintAliases,
): Readonly<{ version: typeof TOPIC_FINGERPRINT_VERSION; metadataSql: string; bodySql: string }> {
  const { post: p, blog: b, body: cb } = checkedAliases(input === undefined ? defaults : input);
  return Object.freeze({
    version: TOPIC_FINGERPRINT_VERSION,
    metadataSql: fingerprint('topic-post-fingerprint-v1', [
      `${p}.id`,
      `${p}.blog_id`,
      `${b}.id`,
      `${b}.url`,
      `${p}.url`,
      textDigest(`${p}.title`),
      textDigest(`${p}.summary`),
      `${p}.content_hash`,
      date(`${p}.published_at`),
    ]),
    bodySql: fingerprint('topic-body-fingerprint-v1', [
      `${cb}.post_id`,
      `${cb}.blog_id`,
      `${cb}.status`,
      `${cb}.content_hash`,
      `${cb}.revision`,
      `${cb}.source_kind`,
      `${cb}.source_url`,
      `${cb}.article_url`,
      `${cb}.adapter_id`,
      `${cb}.adapter_version`,
      `${cb}.rule_revision`,
      date(`${cb}.obtained_at`),
      date(`${cb}.source_updated_at`),
      `${cb}.completeness`,
      `${cb}.truncated`,
      `${cb}.image_only`,
      `OCTET_LENGTH(${cb}.body_text)`,
      `OCTET_LENGTH(${cb}.body_html)`,
    ]),
  });
}
