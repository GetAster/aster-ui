import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lintSource } from "../tools/lint.ts";
import { ELEMENT_RULES, ROLE_RULES } from "../tools/lint-rules.ts";

const rules = (file: string, text: string, theme = false) =>
  lintSource(file, text, { theme })!.findings.map(f => `${f.line}:${f.rule}`);

describe("aster-lint templates and HTML", () => {
  test("native controls in lit templates are found, Aster elements are not", () => {
    const source = [
      "const view = html`<aster-button .label=${'Save'}></aster-button>",
      "  <button type=\"button\">Save</button>",
      "  <input type=\"checkbox\"> <input type=\"radio\"> <input type=\"hidden\"> <input .type=${kind}>",
      "  <select></select><table></table><details></details><dialog></dialog>`;",
    ].join("\n");
    expect(rules("view.ts", source)).toEqual([
      "2:native-button", "3:native-checkbox", "3:native-input", "4:native-select", "4:native-table", "4:native-details", "4:native-dialog",
    ]);
  });

  test("hand-made ARIA widgets are found, on native markup only", () => {
    expect(rules("tabs.js", "html`<div role=\"tablist\"><aster-tabs role=\"tablist\"></aster-tabs><div role=\"tabpanel\"></div></div>`")).toEqual(["1:role-tablist"]);
  });

  test("nested templates, innerHTML and createElement are checked; other strings and comments are not", () => {
    const source = [
      "const a = html`<div>${open ? html`",
      "  <button>Go</button>` : nothing}</div>`;",
      "const label = \"<button>\"; // createElement(\"button\")",
      "host.innerHTML = '<table></table>';",
      "const b = document.createElement(\"select\");",
    ].join("\n");
    expect(rules("mixed.ts", source)).toEqual(["2:native-button", "4:native-table", "5:native-select"]);
  });

  test("an HTML file's markup, style attributes, style blocks and inline scripts are checked", () => {
    const source = [
      "<form><input type=\"email\"></form>",
      "<p style=\"color: #c00\">Warning</p>",
      "<style>.aster-grid-row { padding: 0; }</style>",
      "<script type=\"module\">render(html`<button></button>`, document.body);</script>",
    ].join("\n");
    expect(rules("page.html", source)).toEqual(["1:native-form", "1:native-input", "2:css-colour", "3:css-restyle", "4:native-button"]);
  });
});

describe("aster-lint CSS", () => {
  test("reaching into Aster's markup or styling an Aster element is restyling; placing one is not", () => {
    const source = [
      ".aster-grid-row { padding: 0; }",
      "aster-grid tr { padding: 0; }",
      "aster-split { height: 100%; grid-column: 2; --split-handle: 12px; }",
      "aster-split { background: var(--aster-sunk); }",
      "main > aster-grid { flex: 1; }",
      "aster-check::after { content: ''; }",
      "aster-grid a { color: var(--aster-accent); }",
      "aster-grid .wp-item, aster-grid a.wp-count:hover { color: var(--aster-accent); }",
    ].join("\n");
    expect(rules("app.css", source)).toEqual(["1:css-restyle", "2:css-restyle", "4:css-restyle", "6:css-restyle", "7:css-restyle"]);
  });

  test("fixed colours and fonts are found; tokens and colours derived from them are not", () => {
    const source = [
      ".a { color: #3a6; border: 1px solid rgb(0 0 0 / .1); background: white; }",
      ".b { color: var(--aster-text-2); background: color-mix(in oklch, var(--aster-accent) 20%, transparent); }",
      ".c { box-shadow: 0 1px 2px oklch(from var(--aster-shadow) l c h / .2); white-space: nowrap; }",
      ".d { font-family: Inter, sans-serif; font-weight: 600; }",
      ".e { font-family: var(--aster-font-ui); font-weight: var(--aster-weight-strong); }",
      "@font-face { font-family: \"Brand\"; src: url(brand.woff2); }",
      "@media (min-width: 40em) { .f { color: red; } }",
    ].join("\n");
    expect(rules("app.css", source)).toEqual(["1:css-colour", "1:css-colour", "1:css-colour", "4:css-font", "4:css-font", "7:css-colour"]);
  });

  test("theme tokens may only be set in a theme file", () => {
    const source = ":root { --aster-accent: var(--brand); --app-gap: 8px; }";
    expect(rules("app.css", source)).toEqual(["1:css-token"]);
    expect(rules("theme.css", source, true)).toEqual([]);
  });

  test("a page may set component variables on one placement", () => {
    expect(rules("app.css", "aster-window.minimap { --aster-window-header-height: 30px; --aster-window-inset: 8px; }")).toEqual([]);
    expect(rules("app.css", "aster-window.minimap { --aster-pad: 6px; }")).toEqual(["1:css-token"]);
  });

  test("nested rules combine with their parent's selector", () => {
    expect(rules("app.css", "aster-grid { & tr { padding: 0; } height: 100%; }")).toEqual(["1:css-restyle"]);
  });
});

describe("aster-lint silences", () => {
  test("a silence covers its own line or the next, and must give a reason", () => {
    const source = [
      "<!-- aster-allow native-button: the confirmation step needs a plain submit -->",
      "<button>Send</button>",
      "<select></select> <!-- aster-allow native-select: a native list of 200 time zones -->",
      "<!-- aster-allow native-table -->",
      "<table></table>",
      "<!-- aster-allow native-dialog: nothing here -->",
      "<!-- aster-allow native-buton: misspelt -->",
    ].join("\n");
    const report = lintSource("page.html", source)!;
    expect(report.findings.map(f => `${f.line}:${f.rule}`)).toEqual(["4:allow-reason", "6:allow-unused", "7:allow-unknown"]);
    expect(report.allowances.map(a => [a.line, a.used])).toEqual([[1, true], [3, true], [4, true], [6, false], [7, false]]);
  });

  test("JavaScript and CSS comments silence too, for several rules at once", () => {
    expect(rules("view.ts", "// aster-allow native-button, native-select: a print-only summary\nhtml`<button></button><select></select>`")).toEqual([]);
    expect(rules("app.css", "/* aster-allow css-colour: the brand mark's fixed colour */\n.logo { color: #0a5; }")).toEqual([]);
  });
});

describe("aster-lint catalogue", () => {
  const reference = readdirSync(join(import.meta.dir, "../../../docs/reference"))
    .filter(f => f.endsWith(".md"))
    .map(f => readFileSync(join(import.meta.dir, "../../../docs/reference", f), "utf8"))
    .join("\n");

  test("every suggested element and reference entry exists in the reference", () => {
    for (const rule of [...Object.values(ELEMENT_RULES), ...Object.values(ROLE_RULES)]) {
      for (const entry of rule.entries) expect([rule.id, reference.includes(`\n## ${entry}\n`)]).toEqual([rule.id, true]);
      for (const tag of rule.use) expect([rule.id, reference.includes(`\`${tag}\``)]).toEqual([rule.id, true]);
    }
  });
});
