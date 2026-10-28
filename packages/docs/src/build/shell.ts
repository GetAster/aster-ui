import { esc } from "../shared/dom.ts";

export interface NavigationGroup {
  readonly label: string;
  readonly links: readonly { readonly href: string; readonly label: string }[];
}

export function renderNavigation(groups: readonly NavigationGroup[], overview?: { href: string; label: string }, afterHtml = ""): string {
  return `${overview ? `<a class="nav-overview" href="${esc(overview.href)}">${esc(overview.label)}</a>` : ""}
    ${groups.map(group => `<p class="nav-label">${esc(group.label)}</p><ul>${group.links.map(link => `<li><a href="${esc(link.href)}">${esc(link.label)}</a></li>`).join("")}</ul>`).join("")}${afterHtml}`;
}

export interface ShellConfig {
  readonly siteName: string;
  readonly description?: string;
  readonly wordmark: string;
  readonly section: string;
  readonly homeHref: string;
  readonly assetsHref: string;
  readonly rootHref: string;
  readonly searchHref: string;
  /** Trusted HTML produced by the project's navigation renderer. */
  readonly navigationHtml: string;
  readonly headerLink?: { readonly href: string; readonly label: string };
  readonly stylesheets?: readonly string[];
  readonly llmsHref?: string;
}

export interface ShellPage {
  readonly script?: string;
  readonly routed?: boolean;
  /** Trusted additions such as alternate formats and canonical links. */
  readonly headHtml?: string;
}

/** Body and navigation are trusted, already-rendered HTML; configuration is escaped. */
export function renderShell(title: string, body: string, config: ShellConfig, page: ShellPage = {}): string {
  const assets = config.assetsHref.replace(/\/?$/, "/");
  const styles = config.stylesheets ?? [`${assets}theme.css`, `${assets}docs.css`];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
 <meta name="description" content="${esc(config.description ?? "")}">
 <meta name="aster-docs-root" content="${esc(config.rootHref)}"><meta name="aster-docs-search" content="${esc(config.searchHref)}">
 ${config.llmsHref ? `<link rel="describedby" href="${esc(config.llmsHref)}" type="text/plain">` : ""}
 <title>${esc(title)} · ${esc(config.siteName)}</title>
 <script>try{const s=localStorage.getItem('aster-docs-scheme')||'system';document.documentElement.dataset.scheme=s==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):s}catch{}</script>
 <link rel="preload" href="${esc(assets)}brand/geist/Geist-VariableFont_wght.ttf" as="font" type="font/ttf" crossorigin>
 <link rel="icon" href="${esc(assets)}aster-logo.svg" type="image/svg+xml">${styles.map(href => `<link rel="stylesheet" href="${esc(href)}">`).join("")}${page.headHtml ?? ""}</head>
 <body class="doc ref"${page.routed ? " data-docs-routed" : ""}><a class="skip" href="#content">Skip to content</a>
 <header class="ref-head"><a class="ref-home" href="${esc(config.homeHref)}" aria-label="${esc(config.siteName)} documentation"><img class="brand-mark" src="${esc(assets)}aster-logo.svg" alt="" width="30" height="30"><span class="brand-wordmark">${esc(config.wordmark)}</span><span class="brand-sub">${esc(config.section)}</span></a>
 <div class="ref-search" role="search"><label class="sr-only" for="search">Search documentation</label><svg class="search-symbol" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input id="search" type="search" placeholder="Search documentation…" autocomplete="off" spellcheck="false" aria-describedby="search-status"><kbd class="search-key" aria-hidden="true">⌘ K</kbd><ul id="results" class="ref-results" hidden aria-label="Search results"></ul><p id="search-status" class="sr-only" role="status"></p></div>
 ${config.headerLink ? `<a class="header-showcase" href="${esc(config.headerLink.href)}">${esc(config.headerLink.label)}</a>` : ""}<label class="scheme-label"><span class="sr-only">Colour scheme</span><select id="doc-scheme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
 <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="nav">Menu</button></header>
 <div class="ref-body"><nav id="nav" class="ref-nav" aria-label="Documentation">${config.navigationHtml}</nav>
 <main id="content" class="ref-main" tabindex="-1">${body}</main><aside class="ref-outline" aria-label="On this page"><p>On this page</p><ul id="outline"></ul></aside></div>
 <div id="doc-status" class="sr-only" role="status"></div><script type="module" src="${esc(page.script ?? `${assets}docs.js`)}"></script></body></html>`;
}
