function displayUrl(url: string): string {
  try {
    // Decode readable text while preserving encoded URL delimiters like %2F and %3F.
    return decodeURI(url);
  } catch {
    // Some publishers provide malformed escapes; keep those links readable as-is.
    return url;
  }
}

export default function SourceLink({
  url,
  label = '原站',
  className = '',
  iconOnly = false,
  showUrl = false,
}: {
  url: string | null;
  label?: string;
  className?: string;
  iconOnly?: boolean;
  showUrl?: boolean;
}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return (
    <a
      href={url}
      data-analytics="open_original"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label}（另開視窗）`}
      className={`inline-flex max-w-full min-h-8 items-center gap-1 whitespace-nowrap text-xs text-zinc-500 hover:text-brand-700 dark:text-zinc-400 dark:hover:text-brand-400 ${className}`}
    >
      {showUrl ? <span className="min-w-0 whitespace-normal break-all">{displayUrl(url)}</span> : !iconOnly && label}
      <svg
        className="shrink-0"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="M14 4h6v6M20 4 10 14M10 4H4v16h16v-6" />
      </svg>
    </a>
  );
}
