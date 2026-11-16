/** Blog platforms' default category names (WordPress 未分類／Uncategorized and kin): not a topic anyone chose, so the
 * tag list and the tag ranking leave them out, and the ranking says so. A direct ?tag= link still opens one. */
const PLATFORM_DEFAULT = /^(?:未分類|未分类|無分類|uncategori[sz]ed)$/iu;

export const isPlatformDefaultTag = (label: string) => PLATFORM_DEFAULT.test(label.trim());
