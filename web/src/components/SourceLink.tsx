function displayUrl(url: string): string {
  try {
    // Decode readable text while preserving encoded URL delimiters like %2F and %3F.
    return decodeURI(url);
  } catch {
    // Some publishers provide malformed escapes; keep those links readable as-is.
    return url;
  }
}

/** The site an article lives on, as a reader would type it: no scheme, no leading www. */
function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return displayUrl(url);
  }
}

export default function SourceLink({
  url,
  label = '原站',
  className = '',
  iconOnly = false,
  showHost = false,
}: {
  url: string | null;
  label?: string;
  className?: string;
  iconOnly?: boolean;
  /** Show the site's host name (the full address stays in the tooltip and the link). */
  showHost?: boolean;
}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return (
    <a
      href={url}
      data-analytics="open_original"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={showHost ? `${label} ${displayHost(url)}（另開視窗）` : `${label}（另開視窗）`}
      title={showHost ? displayUrl(url) : undefined}
      className={`inline-flex max-w-full min-h-8 items-center gap-1 whitespace-nowrap text-xs text-zinc-600 hover:text-brand-700 dark:text-zinc-400 dark:hover:text-brand-400 ${className}`}
    >
      {showHost ? <span className="min-w-0 truncate">{displayHost(url)}</span> : !iconOnly && label}
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
