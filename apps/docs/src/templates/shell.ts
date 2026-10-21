import { navigation } from "./navigation.ts";

export function shell(title: string, body: string, script = "../docs-assets/docs.js"): string {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
 <meta name="description" content="Aster UI developer documentation. Connect SQL and backend APIs through Aster WebData virtual data sources, then build connected web interfaces.">
 <link rel="describedby" href="../llms.txt" type="text/plain">
 <title>${title.replaceAll("&", "&amp;").replaceAll("<", "&lt;")} · Aster UI</title>
 <script>try{const s=localStorage.getItem('aster-docs-scheme')||'system';document.documentElement.dataset.scheme=s==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):s}catch{}</script>
 <link rel="preload" href="../docs-assets/brand/geist/Geist-VariableFont_wght.ttf" as="font" type="font/ttf" crossorigin>
 <link rel="icon" href="../docs-assets/aster-logo.svg" type="image/svg+xml"><link rel="stylesheet" href="../lib/themes/lamplight.css"><link rel="stylesheet" href="../docs-assets/docs.css"></head>
 <body class="doc ref"><a class="skip" href="#content">Skip to content</a>
 <header class="ref-head"><a class="ref-home" href="../reference/" aria-label="Aster UI documentation"><img class="brand-mark" src="../docs-assets/aster-logo.svg" alt="" width="30" height="30"><span class="brand-wordmark">aster<span class="brand-period">.</span></span><span class="brand-sub">UI / Docs</span></a>
 <div class="ref-search" role="search"><label class="sr-only" for="search">Search documentation</label><svg class="search-symbol" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input id="search" type="search" placeholder="Search documentation…" autocomplete="off" spellcheck="false" aria-describedby="search-status"><kbd class="search-key" aria-hidden="true">⌘ K</kbd><ul id="results" class="ref-results" hidden aria-label="Search results"></ul><p id="search-status" class="sr-only" role="status"></p></div>
 <a class="header-showcase" href="../#showcase">Showcase ↗</a><label class="scheme-label"><span class="sr-only">Colour scheme</span><select id="doc-scheme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
 <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="nav">Menu</button></header>
 <div class="ref-body"><nav id="nav" class="ref-nav" aria-label="Documentation">${navigation()}</nav>
 <main id="content" class="ref-main" tabindex="-1">${body}</main><aside class="ref-outline" aria-label="On this page"><p>On this page</p><ul id="outline"></ul></aside></div>
 <div id="doc-status" class="sr-only" role="status"></div><script type="module" src="${script}"></script></body></html>`;
}
