// Shared navigation for the independent examples; no vendor code is loaded here.
import "../lib/aster-ui.js";

for (const [id, label, values] of [["theme", "Theme", ["lamplight", "harbour"]], ["scheme", "Scheme", ["light", "dark"]]]) {
  const choice = document.querySelector(`#${id}`);
  choice.label = label;
  choice.options = values.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
  choice.value = values[0];
}
const params = new URLSearchParams(location.search);
const themes = ["lamplight", "harbour"];
const schemes = ["light", "dark"];
const theme = params.get("theme");
const scheme = params.get("scheme");
if (themes.includes(theme)) {
  document.querySelector("#theme").value = theme;
  document.querySelector("#identity").href = `../lib/themes/${theme}.css`;
  document.documentElement.dataset.identity = theme;
}
if (schemes.includes(scheme)) {
  document.querySelector("#scheme").value = scheme;
  document.documentElement.dataset.scheme = scheme;
  document.documentElement.style.colorScheme = scheme;
}
const nav = document.createElement("nav");
nav.className = "showcase-nav";
nav.setAttribute("aria-label", "Component examples");
const examples = [["foundations.html", "Fields & layouts"], ["mail.html", "Mail workspace"], ["composition.html", "Composition"], ["tabs.html", "Tabs"], ["tiles.html", "Tile grids"], ["dataview.html", "DataView"], ["filtering.html", "Filtering"], ["reporting.html", "Reporting"], ["components.html", "Charts"], ["windows.html", "Windows"], ["dashboard.html", "Dashboard"]];
const back = document.createElement("a");
back.textContent = "← Component showcase";
const defaultApp = new URL(document.querySelector('meta[name="aster-site-layout"]') ? "../showcase/" : "../", document.baseURI);
let requestedApp = defaultApp;
try { requestedApp = new URL(params.get("app") ?? defaultApp.href, location.href); } catch { /* Malformed return URLs use the showcase root. */ }
const app = requestedApp.origin === location.origin ? requestedApp : defaultApp;
app.hash = "showcase";
back.href = app.href;
nav.append(back);
for (const [file, label] of examples) {
  const link = document.createElement("a");
  link.textContent = label;
  link.href = file;
  if (location.pathname.endsWith(`/${file}`)) link.setAttribute("aria-current", "page");
  nav.append(link);
}
function updateLinks() {
  for (const link of nav.querySelectorAll("a")) {
    const url = new URL(link.href);
    if (link !== back) {
      url.searchParams.set("theme", document.querySelector("#theme").value);
      url.searchParams.set("scheme", document.querySelector("#scheme").value);
      url.searchParams.set("showcase", "1");
      url.searchParams.set("app", app.pathname);
    } else {
      url.searchParams.set("identity", document.querySelector("#theme").value);
      url.searchParams.set("scheme", document.querySelector("#scheme").value);
    }
    link.href = url.href;
  }
}
function applyAppearance() {
  const theme = document.querySelector("#theme").value;
  const scheme = document.querySelector("#scheme").value;
  const stylesheet = document.querySelector("#identity");
  const href = new URL(`../lib/themes/${theme}.css`, document.baseURI).href;
  if (stylesheet.href !== href) stylesheet.href = href;
  document.documentElement.dataset.identity = theme;
  document.documentElement.dataset.scheme = scheme;
  document.documentElement.style.colorScheme = scheme;
  updateLinks();
}
for (const id of ["theme", "scheme"]) document.querySelector(`#${id}`).addEventListener("change", applyAppearance);
applyAppearance();
const embedded = params.get("embedded") === "1" && parent !== window;
if (!embedded) {
  document.querySelector("main").prepend(nav);
  const demo = location.pathname.split("/").pop().replace(".html", "");
  for (const link of document.querySelectorAll("main a[href]")) {
    if (link.hasAttribute("download")) continue;
    const target = new URL(link.href);
    if (target.origin !== location.origin) continue;
    if (["composition", "mail"].includes(demo) && /\.(?:js|yaml|css)$/.test(target.pathname)) {
      const viewer = new URL(`../examples/${demo}.html`, location.href);
      viewer.searchParams.set("source", target.pathname.split("/").pop());
      viewer.searchParams.set("theme", document.querySelector("#theme").value);
      viewer.searchParams.set("scheme", document.querySelector("#scheme").value);
      viewer.hash = "application-source";
      link.href = viewer.href;
    } else if (!/\/(?:guide|reference)\//.test(target.pathname)) continue;
    link.target = "_blank";
    link.rel = "noopener";
    link.setAttribute("aria-label", `${link.textContent.trim()} (opens in a new tab)`);
  }
}
else {
  const demo = location.pathname.split("/").pop().replace(".html", "");
  document.documentElement.dataset.embedded = "";
  document.documentElement.dataset.demo = demo;
  document.querySelector("main").setAttribute("aria-label", document.title);
  const state = () => parent.postMessage({ type: "aster-demo-state", state: { theme: document.querySelector("#theme").value, scheme: document.querySelector("#scheme").value } }, location.origin);
  const height = () => parent.postMessage({ type: "aster-demo-height", height: Math.ceil(document.body.getBoundingClientRect().height) }, location.origin);
  new ResizeObserver(height).observe(document.body);
  for (const id of ["theme", "scheme"]) document.querySelector(`#${id}`).addEventListener("change", state);
  addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    if (event.data?.type === "aster-example-appearance" && schemes.includes(event.data.scheme)) {
      document.querySelector("#scheme").value = event.data.scheme;
      if (themes.includes(event.data.theme)) document.querySelector("#theme").value = event.data.theme;
      applyAppearance(); state();
    }
    if (event.data?.type === "aster-demo-request") { state(); height(); }
  });
  state(); height();
}
