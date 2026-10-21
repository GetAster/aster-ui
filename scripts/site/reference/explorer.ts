/** Connect a live example to the docs URL without exposing application internals. */
export function initExplorer(): void {
  const frame = document.querySelector<HTMLIFrameElement>("[data-collection-preview], [data-demo-preview]");
  if (!frame) return;
  const demo = frame.dataset.demoFile;
  const allowed = demo ? ["theme", "scheme"] : ["dataset", "view", "sort", "selection", "q", "platform", "online", "size"];
  const url = new URL(`../playground/${demo ?? "collection-demo"}.html`, location.href);
  const incoming = new URLSearchParams(location.search);
  for (const name of allowed) if (incoming.has(name)) url.searchParams.set(name, incoming.get(name)!.slice(0, 80));
  if (!demo && !url.searchParams.has("view")) url.searchParams.set("view", frame.dataset.defaultView ?? "table");
  const standalone = document.querySelector<HTMLAnchorElement>("#standalone-example")!;
  standalone.href = url.href;
  if (demo) {
    url.searchParams.set("embedded", "1");
    const scheme = document.querySelector<HTMLSelectElement>("#doc-scheme")!;
    const requested = incoming.get("scheme");
    if (requested === "light" || requested === "dark") { scheme.value = requested; scheme.dispatchEvent(new Event("change")); }
    url.searchParams.set("scheme", document.documentElement.dataset.scheme ?? "light");
  }
  addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    switch (event.data?.type) {
      case "aster-demo-state":
      case "aster-collection-state": {
        const state = event.data.state;
        if (!state || typeof state !== "object") return;
        const next = new URL(location.href);
        for (const name of allowed) {
          const value = state[name];
          if (typeof value !== "string" && typeof value !== "boolean") continue;
          next.searchParams.set(name, String(value).slice(0, 80));
          url.searchParams.set(name, String(value).slice(0, 80));
        }
        history.replaceState(null, "", next);
        const fullSize = new URL(url); fullSize.searchParams.delete("embedded"); standalone.href = fullSize.href;
        break;
      }
      case "aster-demo-height":
      case "aster-collection-height": {
        const height = event.data.height;
        if (Number.isFinite(height)) frame.style.height = `${Math.max(500, Math.min(2400, height + 2))}px`;
        break;
      }
    }
  });
  const source = document.querySelector<HTMLSelectElement>("#source-file")!;
  const sourcePanel = document.querySelector<HTMLDetailsElement>(".example-source")!;
  const sections = [...document.querySelectorAll<HTMLElement>("[data-source-file]")];
  const back = document.querySelector<HTMLButtonElement>(".example-return-preview")!;
  let returnTo: { element: HTMLElement; x: number; y: number } | undefined;
  const selectSource = () => {
    for (const section of sections) section.hidden = section.dataset.sourceFile !== source.value;
  };
  const showSource = (file: string, opener?: HTMLElement) => {
    if (![...source.options].some(option => option.value === file)) return;
    returnTo = opener ? { element: opener, x: scrollX, y: scrollY } : undefined;
    source.value = file;
    selectSource();
    sourcePanel.open = true;
    source.focus({ preventScroll: true });
    sourcePanel.scrollIntoView({ block: "start" });
  };
  source.addEventListener("change", selectSource);
  back.addEventListener("click", () => {
    const next = new URL(location.href);
    next.searchParams.delete("source");
    if (next.hash === "#application-source") next.hash = "";
    history.replaceState(null, "", next);
    if (returnTo?.element.isConnected) {
      returnTo.element.focus({ preventScroll: true });
      window.scrollTo(returnTo.x, returnTo.y);
    } else {
      const heading = document.querySelector<HTMLElement>("#preview-heading")!;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.closest(".example-preview")!.scrollIntoView({ block: "start" });
    }
  });
  frame.addEventListener("load", () => {
    frame.contentWindow?.postMessage({ type: demo ? "aster-demo-request" : "aster-collection-request" }, location.origin);
    const content = frame.contentDocument;
    if (!content) return;
    for (const link of content.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (link.hasAttribute("download")) continue;
      const target = new URL(link.href);
      const section = sections.find(section => section.querySelector<HTMLAnchorElement>(".example-source-name a")?.href === target.href);
      if (section) {
        const file = section.dataset.sourceFile!;
        const destination = new URL(location.href);
        destination.searchParams.set("source", file);
        destination.hash = "application-source";
        link.href = destination.href;
        link.target = "_top";
        link.addEventListener("click", event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          showSource(file, link);
        });
      } else if (target.origin === location.origin && /\/(?:guide|reference)\//.test(target.pathname)) {
        link.target = "_blank";
        link.rel = "noopener";
        link.setAttribute("aria-label", `${link.textContent?.trim()} (opens in a new tab)`);
      }
    }
  });
  frame.src = url.href;
  const requestedSource = incoming.get("source");
  if (requestedSource) showSource(requestedSource);
  document.querySelector("#copy-example-link")!.addEventListener("click", async () => {
    const status = document.querySelector("#doc-status")!;
    try { await navigator.clipboard.writeText(location.href); status.textContent = "Example link copied. Scenario settings are included."; }
    catch { status.textContent = "Copy unavailable. Copy the page URL from your address bar."; }
  });
}
