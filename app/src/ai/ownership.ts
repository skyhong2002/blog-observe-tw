/** Versioned, label-free site-level excerpts. Article/comment text is never classification evidence. */
export const OWNERSHIP_VERSION = 'site-ownership-v3';
const excludedPattern = /新聞(?:媒體|網)|編輯(?:部|團隊)|購物車|加入購物車|企業官方|公司官網|公司公告|newsroom|add to cart|corporate blog/i;
export const organizationEvidence = (text: string) => excludedPattern.test(text);
export function selfDescription(text: string) {
  const personal = /個人(?:的)?部落格|私人(?:的)?部落格|personal blog|個人網站|個人網誌/i.test(text);
  const chineseIdentity = /我(?:是|叫)(?!否|不是|不該|應該)[\p{L}\p{N}][\p{L}\p{N} _·-]{1,39}(?:[。，,!?！？、：:\n]|$)/u.test(text);
  // Keep the proper-name capital separate from case-insensitive matching: "I am going" is not a name.
  const englishIdentity = /\bI(?:'m| am)\s+(?!Going\b|Writing\b|Trying\b|Thinking\b)[A-Z][\p{L}'’-]{1,39}(?:\s|[.,!:;]|$)/u.test(text);
  const explicitAbout = /關於我(?!們)|\babout me\b/i.test(text);
  return (
    personal &&
    (chineseIdentity || englishIdentity || explicitAbout) &&
    !organizationEvidence(text) &&
    !/我們|我们|\b(?:we|our|us)\b/i.test(text)
  );
}
/** Site-level first-person introduction, using what the owner says rather than pronoun counts. */
export function firstPersonIntroduction(text: string) {
  if (text.length < 30 || organizationEvidence(text) || /我們|我们|\b(?:we|our|us)\b/i.test(text)) return false;
  const named =
    /我(?:是|叫)\s*[\p{L}\p{N}][\p{L}\p{N} _·-]{1,39}[。，,!！?？、：:]/u.test(text) ||
    /\bI(?:'m| am)\s+[A-Z][\p{L}'’-]{1,39}(?:[.,!]|$)/u.test(text);
  const activity = /我(?:喜歡|喜欢|寫|写|分享|記錄|记录|擅長|擅长|住|在)|\bI (?:write|share|live|work|love|enjoy)\b/i.test(text);
  const context =
    /這裡|这里|這個網站|这个网站|本站|我的(?:網站|网站|部落格|網誌)|興趣|兴趣|畢業|毕业|生活|\b(?:my (?:work|blog|site)|here|about me)\b/i.test(
      text,
    );
  return (named && context) || (activity && (named || context));
}
export const ownerIntroduction = (text: string) => selfDescription(text) || firstPersonIntroduction(text);
/** Canonical JSON array of website strings: no generated prompt labels can qualify as quotations. */
export function ownershipInput(segments: string[]): string {
  const bounded: string[] = [];
  for (const segment of segments) {
    if (!segment || segment.length > 1000 || bounded.includes(segment)) continue;
    if (bounded.length >= 12 || Buffer.byteLength(JSON.stringify([...bounded, segment])) > 11000) break;
    bounded.push(segment);
  }
  return JSON.stringify(bounded);
}
export function ownershipSegments(input: string): string[] | null {
  try {
    const value: unknown = JSON.parse(input);
    if (!Array.isArray(value) || value.length > 12 || value.some((s) => typeof s !== 'string' || !s || s.length > 1000)) return null;
    return ownershipInput(value) === input ? value : null;
  } catch {
    return null;
  }
}
export function ownershipQuotes(input: string, quotes: unknown): boolean {
  const segments = ownershipSegments(input);
  return Boolean(
    segments?.length &&
      !segments.some(organizationEvidence) &&
      Array.isArray(quotes) &&
      quotes.length > 0 &&
      quotes.length <= 5 &&
      quotes.every(
        (q) => typeof q === 'string' && q.length >= 8 && q.length <= 300 && selfDescription(q) && segments.some((s) => s.includes(q)),
      ),
  );
}
