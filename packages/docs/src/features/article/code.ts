import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import rust from "highlight.js/lib/languages/rust";
import powershell from "highlight.js/lib/languages/powershell";
import yaml from "highlight.js/lib/languages/yaml";
for (const [name, language] of Object.entries({ javascript, typescript, xml, css, json, bash, yaml, rust, powershell })) hljs.registerLanguage(name, language);

import { $ } from "../../shared/dom.ts";

export function enhanceCode(main: HTMLElement): void {
  for (const code of main.querySelectorAll<HTMLElement>("pre > code")) {
    const raw = code.textContent ?? "";
    const lang = /language-([\w-]+)/.exec(code.className)?.[1];
    if (lang && hljs.getLanguage(lang)) code.innerHTML = hljs.highlight(raw, { language: lang }).value;
    const pre = code.parentElement!;
    pre.tabIndex = 0;
    pre.setAttribute("role", "group");
    pre.setAttribute("aria-label", `${lang ?? "API signature"} code example`);
    const frame = document.createElement("div"); frame.className = "code-frame";
    pre.before(frame); frame.append(pre);
    const toolbar = document.createElement("div"); toolbar.className = "code-toolbar";
    const label = document.createElement("span"); label.textContent = lang ?? "Signature";
    const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "Copy";
    copy.setAttribute("aria-label", `Copy ${lang ?? "signature"} code`);
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(raw); copy.textContent = "Copied"; $("#doc-status").textContent = "Code copied to clipboard"; }
      catch { $("#doc-status").textContent = "Copy unavailable. Select the code to copy it."; }
      setTimeout(() => { copy.textContent = "Copy"; }, 2000);
    });
    toolbar.append(label, copy); frame.prepend(toolbar);
  }
}
