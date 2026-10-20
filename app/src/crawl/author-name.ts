// Feed author fields are not names. RSS 2.0 <author> is defined as an email address, Blogger writes
// `noreply@blogger.com (Name)`, and themes fill in Unknown/admin. Only the person's name may be stored or shown.

const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Placeholders a platform writes when the author left the name empty. */
const PLACEHOLDERS = new Set([
  'unknown',
  'anonymous',
  'admin',
  'administrator',
  'author',
  'editor',
  'webmaster',
  'root',
  'guest',
  'user',
  'null',
  'undefined',
  'none',
  'n/a',
  '匿名',
  '管理員',
  '管理员',
  '未知',
]);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match;
    const point = code[1] === 'x' || code[1] === 'X' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}

/** The display name in a feed author field, or null when it holds only an address or a placeholder. */
export function cleanAuthorName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Twice: feeds that escape twice give `&amp;#39;`.
  let value = decodeEntities(decodeEntities(String(raw)))
    .replace(/\s+/g, ' ')
    .trim();
  // `address (Name)` (RSS 2.0, Blogger) and `Name <address>` (mail style).
  const parenthesised = value.match(/^\S+@\S+\s*\((.+)\)$/);
  if (parenthesised) value = parenthesised[1];
  value = value
    .replace(/<[^>]*@[^>]*>/g, ' ')
    .replace(EMAIL, ' ')
    .replace(/^mailto:/i, '')
    .replace(/[()<>]\s*[()<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:|/()<>-]+|[\s,;:|/()<>-]+$/g, '')
    .trim();
  if (!value || /^https?:\/\//i.test(value)) return null;
  if (PLACEHOLDERS.has(value.toLocaleLowerCase('en'))) return null;
  return value.length > 255 ? Array.from(value).slice(0, 255).join('').trim() : value;
}

/** The key one blog's author rows are matched on (authors.normalized_name). */
export function normalizedAuthorName(displayName: string) {
  const normalized = displayName.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, ' ').trim();
  return Array.from(normalized).slice(0, 255).join('');
}
