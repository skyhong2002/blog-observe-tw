# Frontend parity with 新文易數

Reference: `skyhong2002/tag.observe.tw` commit `afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39` from the read-only `/home/deck/.cache/tag-visuals` checkout. Blog base: `696c39bb5f904f096a653f4125bf294b61bd6253` fetched from `origin/main`.

The previous landing-page design and its global `.site-header` / `.nav-links` / `.footer-links` styles were removed. The replacement uses actual upstream source, rather than recreating a similar design:

- Global Tailwind 4 CSS and PostCSS configuration, font stack, zinc surfaces and orange accents.
- `SiteHeader`, `SiteNavigation`, `NavPending`, `SiteSearch`, `ThemeToggle`, `ThemeSync`, `AccountMenu`, `Avatar`, `InstallApp`, `BackToTop`, and `TouchTitleHint`.
- Footer structure with 「資料與透明度」「開發與聯絡」 navigation columns, source notes and install prompt.
- Home CSS module, masthead word cloud and ranking section structure.
- Article rows, `SectionTabs`, `MediaTabs`, `MediaSidebar`, profile structure, table styling / scrolling, and chart visibility wrapper.
- Before-paint theme bootstrap, saved/system theme switching, keyboard skip link, responsive menu and web app manifest.

Brand paths are generated with the upstream brand tool's Noto Serif TC outline technique. The masthead / app icon uses 「部落格／觀察」 with a notebook mark; the compact header uses the corresponding horizontal wordmark. SVG, favicon, Open Graph PNG and app icons are provided. Font license is preserved with the assets.

## Intentional differences

Only the entities, brand and data-dependent features differ:

- 「每一種生活，各自怎麼寫」 replaces the news slogan; the grouped menu links to articles, tags, blog directory, authors and subscriptions.
- Indexed article count and number of participating blogs replace news-event growth. Labels explicitly describe the available collection, not quality or inferred traffic. No synthetic growth or visitor statistics are displayed.
- Blog profile metadata distinguishes last successful crawl from last publication and expected cadence. Missing traffic has an honest empty state, and Similarweb remains disabled.
- Authentication, subscriptions, discovery administration, API origins and manifest identity remain blog-only. News-specific analytics, reader presence and political attribution are not connected to tag.

## Verification and deployment

Build and preview in the isolated worktree; the production `.next` directory is not rebuilt in place. Gateway preview uses 18165 and web preview 18166; production remains 18160 and 18162. The frontend consumes only blog's read-only `/api/overview` and existing APIs. It introduces no database migration, no seed import and no worker scheduling change.

Before switching, run TypeScript, Vitest, Biome and a production Next build and verify the isolated HTTP endpoints. The collaborative browser cannot reach the Steam Machine loopback, so capture the actual public desktop/mobile and light/dark screenshots after the reversible switch. After switching, verify `/`, `/blogs/`, `/blogs/kocpc/`, `/healthz`, OAuth's exact callback + S256, and sibling sites' HTTP status. Private UI uses client requests to gateway, because UI proxy must never forward session credentials wholesale.

Runtime uses an immutable release folder and systemd drop-ins for gateway/web; removing those drop-ins restores the previous checkout and standalone web build. Worker remains on its existing release and isolated queue. Record exact release and screenshot evidence after acceptance.
