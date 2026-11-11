// aster-lint's checks: native controls and hand-made ARIA widgets that Aster
// provides as elements, and CSS that restyles Aster or bypasses its theme
// tokens. A finding is silenced by an `aster-allow <rule>: <reason>` comment
// on its line or the line above; a silence with no reason, an unknown rule
// or nothing to silence is itself a finding.
import { CSS_RULES, LAYOUT_PROPERTIES, ROLE_RULES, elementRule, type ElementRule } from "./lint-rules.ts";

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly rule: string;
  readonly message: string;
}
export interface Allowance {
  readonly file: string;
  readonly line: number;
  readonly rules: readonly string[];
  readonly reason: string;
  used: boolean;
}
export interface LintOptions {
  /** A theme file may define `--aster-*` tokens. */
  readonly theme?: boolean;
}
export interface LintReport {
  readonly findings: readonly Finding[];
  readonly allowances: readonly Allowance[];
}

/** Every rule id a silence may name. */
export function ruleIds(): ReadonlySet<string> {
  const ids = new Set<string>(Object.values(CSS_RULES));
  for (const tag of ["button", "textarea", "select", "table", "dialog", "details", "progress", "form"]) ids.add(elementRule(tag, undefined)!.id);
  for (const type of ["checkbox", "text"]) ids.add(elementRule("input", type)!.id);
  for (const role of Object.values(ROLE_RULES)) ids.add(role.id);
  return ids;
}

type Kind = "css" | "html" | "js";
export function kindOf(file: string): Kind | undefined {
  if (/\.d\.ts$|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) return undefined;
  if (/\.css$/.test(file)) return "css";
  if (/\.html?$/.test(file)) return "html";
  if (/\.[cm]?[jt]sx?$/.test(file)) return "js";
  return undefined;
}

/** Lint one file's text. Returns undefined for a file type that isn't checked. */
export function lintSource(file: string, text: string, options: LintOptions = {}): LintReport | undefined {
  const kind = kindOf(file);
  if (!kind) return undefined;
  const raw: { offset: number; rule: string; message: string }[] = [];
  const report = (offset: number, rule: string, message: string) => raw.push({ offset, rule, message });
  switch (kind) {
    case "css": lintCss(text, 0, report, options); break;
    case "html": lintHtml(text, 0, report, options); break;
    case "js": lintJs(text, report, options); break;
  }
  const lines = lineStarts(text);
  const allowances = parseAllowances(file, text, lines);
  const known = ruleIds();
  const findings: Finding[] = [];
  const at = (offset: number) => { const line = lineOf(lines, offset); return { line, column: offset - lines[line - 1]! + 1 }; };
  for (const item of raw) {
    const { line, column } = at(item.offset);
    const allowed = allowances.filter(a => a.rules.includes(item.rule) && (a.line === line || a.line === line - 1));
    if (allowed.length) { for (const a of allowed) a.used = true; continue; }
    findings.push({ file, line, column, rule: item.rule, message: item.message });
  }
  for (const a of allowances) {
    const unknown = a.rules.filter(r => !known.has(r));
    if (unknown.length) findings.push({ file, line: a.line, column: 1, rule: "allow-unknown", message: `aster-allow names no rule: ${unknown.join(", ")}` });
    if (!a.reason) findings.push({ file, line: a.line, column: 1, rule: "allow-reason", message: "aster-allow needs a reason: aster-allow <rule>: <why Aster has no fit>" });
    if (!a.used && !unknown.length) findings.push({ file, line: a.line, column: 1, rule: "allow-unused", message: `aster-allow ${a.rules.join(", ")} silences nothing on this line or the next; remove it` });
  }
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return { findings, allowances };
}

// ── positions and silences ──

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}
function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= offset) lo = mid; else hi = mid - 1; }
  return lo + 1;
}
function parseAllowances(file: string, text: string, lines: readonly number[]): Allowance[] {
  const found: Allowance[] = [];
  const pattern = /aster-allow\s+([a-z][a-z0-9-]*(?:\s*,\s*[a-z][a-z0-9-]*)*)\s*(?::([^\n]*?))?\s*(?:-->|\*\/|$)/gm;
  for (const match of text.matchAll(pattern)) {
    const rules = match[1]!.split(",").map(r => r.trim());
    found.push({ file, line: lineOf(lines, match.index!), rules, reason: (match[2] ?? "").trim(), used: false });
  }
  return found;
}

const REFERENCE = "https://ui.getaster.now/docs/reference/";

type Report = (offset: number, rule: string, message: string) => void;

function advice(what: string, rule: ElementRule): string {
  const use = rule.use.length > 1 ? `${rule.use.slice(0, -1).join(", ")} or ${rule.use.at(-1)}` : rule.use[0];
  return `${what} has an Aster element: ${use} (${REFERENCE}#${rule.entries[0]}). If none fits, add "aster-allow ${rule.id}: <why>" and record the gap.`;
}

// ── JavaScript and TypeScript: lit templates, innerHTML and createElement ──

interface Literal { readonly start: number; readonly end: number; readonly body: string; readonly tag: string | undefined; readonly quoted: boolean }

/** Template and string literals, with `${…}` blanked to spaces and nested templates listed too. */
function literals(text: string): { found: Literal[]; code: string } {
  const found: Literal[] = [];
  const code = text.split("");
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (code[k] !== "\n") code[k] = " "; };
  let last = "";
  const regexAllowed = () => last === "" || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /\b(?:return|typeof|case|in|of|void|yield|await)$/.test(last);
  const tagBefore = (at: number) => /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(Math.max(0, at - 40), at))?.[1];
  const scan = (i: number, stopAtBrace: boolean): number => {
    let depth = 0;
    while (i < text.length) {
      const c = text[i]!;
      if (c === "/" && text[i + 1] === "/") { const e = text.indexOf("\n", i); const end = e < 0 ? text.length : e; blank(i, end); i = end; continue; }
      if (c === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i + 2); const end = e < 0 ? text.length : e + 2; blank(i, end); i = end; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
        found.push({ start: i + 1, end: j, body: text.slice(i + 1, j), tag: undefined, quoted: true });
        blank(i, j + 1); i = j + 1; last = "x"; continue;
      }
      if (c === "`") { i = template(i); last = "x"; continue; }
      if (c === "/" && regexAllowed()) {
        let j = i + 1, inClass = false;
        while (j < text.length && text[j] !== "\n" && (inClass || text[j] !== "/")) { if (text[j] === "\\") j++; else if (text[j] === "[") inClass = true; else if (text[j] === "]") inClass = false; j++; }
        blank(i, j + 1); i = j + 1; while (/[a-z]/.test(text[i] ?? "")) i++; last = "x"; continue;
      }
      if (c === "{") depth++;
      if (c === "}") { if (stopAtBrace && depth === 0) return i + 1; depth--; }
      if (!/\s/.test(c)) last = /[\w$]/.test(c) ? (/[\w$]/.test(last.at(-1) ?? "") ? last + c : c) : c;
      i++;
    }
    return i;
  };
  const template = (open: number): number => {
    const tag = tagBefore(open);
    const parts: string[] = [];
    let i = open + 1, from = i;
    while (i < text.length && text[i] !== "`") {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === "$" && text[i + 1] === "{") {
        parts.push(text.slice(from, i));
        const end = scan(i + 2, true);
        parts.push(text.slice(i, end).replace(/[^\n]/g, " "));
        i = from = end; continue;
      }
      i++;
    }
    parts.push(text.slice(from, i));
    found.push({ start: open + 1, end: i, body: parts.join(""), tag, quoted: false });
    blank(open, i + 1);
    return i + 1;
  };
  scan(0, false);
  return { found, code: code.join("") };
}

function lintJs(text: string, report: Report, options: LintOptions): void {
  // Literal bodies are linted at their offsets; `code` has literals and comments blanked.
  const { found, code } = literals(text);
  for (const literal of found) {
    const before = text.slice(Math.max(0, literal.start - 80), literal.start - 1);
    const htmlSink = /(?:inner|outer)HTML\s*\+?=\s*$|insertAdjacentHTML\s*\(\s*(?:"[^"]*"|'[^']*')\s*,\s*$/.test(before);
    if (!literal.quoted && literal.tag === "html") lintHtml(literal.body, literal.start, report, options);
    else if (!literal.quoted && literal.tag === "css") lintCss(literal.body, literal.start, report, options);
    else if (htmlSink) lintHtml(literal.body, literal.start, report, options);
  }
  for (const match of text.matchAll(/\bcreateElement\s*\(\s*(["'])([A-Za-z][\w-]*)\1/g)) {
    if (code.slice(match.index!, match.index! + 13) !== "createElement") continue;
    const tag = match[2]!.toLowerCase();
    const rule = elementRule(tag, undefined);
    if (rule) report(match.index!, rule.id, advice(`createElement("${tag}")`, rule));
  }
}

// ── HTML ──

function lintHtml(text: string, base: number, report: Report, options: LintOptions): void {
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    if (text.startsWith("<!--", lt)) { const e = text.indexOf("-->", lt + 4); i = e < 0 ? text.length : e + 3; continue; }
    const name = /^<([A-Za-z][\w-]*)/.exec(text.slice(lt, lt + 64))?.[1];
    if (!name) { i = lt + 1; continue; }
    let j = lt + 1 + name.length, quote = "";
    while (j < text.length && (quote || text[j] !== ">")) { const c = text[j]!; if (quote) { if (c === quote) quote = ""; } else if (c === '"' || c === "'") quote = c; j++; }
    const attrsText = text.slice(lt + 1 + name.length, j);
    const tag = name.toLowerCase();
    const attrs = attributes(attrsText, base + lt + 1 + name.length);
    // A dynamic type (`type=${…}`, blanked) counts as text.
    const type = tag === "input" ? attrs.get("type")?.value.trim().toLowerCase() || undefined : undefined;
    const rule = elementRule(tag, type);
    if (rule) report(base + lt, rule.id, advice(`<${tag}${type ? ` type="${type}"` : ""}>`, rule));
    const role = attrs.get("role")?.value.trim().split(/\s+/)[0]?.toLowerCase();
    if (role && Object.hasOwn(ROLE_RULES, role) && !tag.startsWith("aster-")) report(base + lt, ROLE_RULES[role]!.id, advice(`role="${role}"`, ROLE_RULES[role]!));
    const style = attrs.get("style");
    if (style) lintDeclarations(style.value, style.offset, [], report, options, {});
    i = j + 1;
    if (tag === "style" || tag === "script") {
      const close = text.toLowerCase().indexOf(`</${tag}`, i);
      const end = close < 0 ? text.length : close;
      if (tag === "style") lintCss(text.slice(i, end), base + i, report, options);
      else if (!attrs.has("src")) { const from = i; lintJs(text.slice(from, end), (offset, r, m) => report(base + from + offset, r, m), options); }
      i = end;
    }
  }
}

function attributes(text: string, base: number): Map<string, { value: string; offset: number }> {
  const found = new Map<string, { value: string; offset: number }>();
  for (const match of text.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']*)))?/g)) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    const quoteSkip = match[2] !== undefined || match[3] !== undefined ? 1 : 0;
    const offset = base + match.index! + match[0].length - value.length - quoteSkip;
    found.set(match[1]!.toLowerCase(), { value, offset });
  }
  return found;
}

// ── CSS ──

const NAMED_COLOURS = "black|white|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|brown|navy|teal|maroon|olive|lime|aqua|fuchsia|cyan|magenta|gold|indigo|violet|crimson|coral|salmon|tomato|beige|ivory|khaki|tan|plum|orchid|turquoise|lavender|chocolate|firebrick|darkred|darkblue|darkgreen|darkgray|darkgrey|lightgray|lightgrey|lightblue|lightgreen|whitesmoke|gainsboro|slategray|slategrey|steelblue|skyblue|royalblue|seagreen|forestgreen|goldenrod|hotpink|deeppink";
const COLOUR = new RegExp(`#[0-9a-fA-F]{3,8}(?![\\w-])|(?<![\\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(([^()]|\\([^()]*\\))*\\)|(?<![\\w-])(?:${NAMED_COLOURS})(?![\\w-])`, "gi");
const SHAPE_FONT = /(?<![\w-])(?:serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-sans-serif|ui-serif|ui-monospace)(?![\w-])|["']/;

interface CssContext { readonly fontFace?: boolean }

function blankComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
}

function lintCss(source: string, base: number, report: Report, options: LintOptions): void {
  const text = blankComments(source);
  block(text, 0, text.length, [], {}, base, report, options);
}

/** Parse declarations and nested rules from `start` to the block's closing brace; returns the index after it. */
function block(text: string, start: number, end: number, selectors: readonly Selector[], context: CssContext, base: number, report: Report, options: LintOptions): number {
  let i = start;
  const declarations: { text: string; offset: number }[] = [];
  while (i < end) {
    while (i < end && /\s/.test(text[i]!)) i++;
    if (i >= end) break;
    if (text[i] === "}") { i++; break; }
    let j = i, paren = 0, quote = "";
    while (j < end) {
      const c = text[j]!;
      if (quote) { if (c === quote) quote = ""; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === "(") paren++;
      else if (c === ")") paren--;
      else if (paren === 0 && (c === ";" || c === "{" || c === "}")) break;
      j++;
    }
    const segment = text.slice(i, j);
    if (text[j] === "{") {
      const prelude = segment.trim();
      const at = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
      if (at === undefined) {
        const own = splitTop(prelude, ",").map(s => s.trim()).filter(Boolean).map(s => ({ text: s, offset: base + i + segment.indexOf(s) }));
        const combined = selectors.length === 0 ? own : selectors.flatMap(p => own.map(c => ({ text: c.text.includes("&") ? c.text.replaceAll("&", p.text) : `${p.text} ${c.text}`, offset: c.offset })));
        const parsed = combined.map(parseSelector);
        for (const s of parsed) if (s.inside) report(s.offset, CSS_RULES.restyle, `${s.inside} restyles Aster's own markup; change it through a theme token or a documented property, or ask for one.`);
        i = block(text, j + 1, end, parsed, context, base, report, options);
      } else if (["media", "supports", "container", "layer", "scope", "document", "starting-style"].includes(at)) {
        i = block(text, j + 1, end, selectors, context, base, report, options);
      } else if (at === "font-face") {
        i = block(text, j + 1, end, [], { fontFace: true }, base, report, options);
      } else if (at.endsWith("keyframes")) {
        i = block(text, j + 1, end, [], {}, base, report, options);
      } else {
        i = skipBlock(text, j + 1, end);
      }
      continue;
    }
    if (segment.trim()) declarations.push({ text: segment, offset: base + i });
    i = text[j] === "}" ? j : j + 1;
  }
  for (const d of declarations) lintDeclarations(d.text, d.offset, selectors, report, options, context);
  return i;
}

function skipBlock(text: string, i: number, end: number): number {
  let depth = 1;
  while (i < end && depth > 0) { if (text[i] === "{") depth++; else if (text[i] === "}") depth--; i++; }
  return i;
}

function splitTop(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === separator && depth === 0) { out.push(text.slice(from, i)); from = i + 1; }
  }
  out.push(text.slice(from));
  return out;
}

interface Selector {
  readonly text: string;
  readonly offset: number;
  /** What reaches inside an Aster element, if anything. */
  readonly inside: string | undefined;
  /** The Aster element this rule styles directly, if any. */
  readonly host: string | undefined;
}

function parseSelector(selector: { text: string; offset: number }): Selector {
  const text = selector.text;
  const internal = /\.aster-[\w-]+/.exec(text)?.[0];
  // The last compound: what follows the last top-level combinator.
  let depth = 0, last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) last = i + 1;
  }
  const types = [...text.matchAll(/(?<![\w.#:[\-])aster-[a-z][\w-]*/g)];
  // Inside an Aster element, a subject with the app's own class or id is the app's content (a renderer's markup), not Aster's.
  const own = /[.#](?!aster-)[A-Za-z_][\w-]*/.test(text.slice(last));
  const outer = own ? undefined : types.find(t => t.index! < last);
  const subject = types.find(t => t.index! >= last);
  const pseudo = subject && /::[\w-]+/.exec(text.slice(last))?.[0];
  const inside = internal ? `"${internal}"` : outer ? `"${text.trim()}" (inside ${outer[0]})` : pseudo ? `"${subject![0]}${pseudo}"` : undefined;
  return { text, offset: selector.offset, inside, host: inside ? undefined : subject?.[0] };
}

function lintDeclarations(text: string, base: number, selectors: readonly Selector[], report: Report, options: LintOptions, context: CssContext): void {
  let at = 0;
  for (const part of splitTop(text, ";")) {
    const start = at;
    at += part.length + 1;
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1);
    const offset = base + start + part.search(/\S/);
    if (!property || /\s/.test(property)) continue;
    if (property.startsWith("--aster-") && !options.theme) report(offset, CSS_RULES.token, `${property} is a theme token; set it in a theme file (aster-lint --theme), not here.`);
    const host = selectors.find(s => s.host)?.host;
    if (host && !property.startsWith("--") && !LAYOUT_PROPERTIES.has(property)) report(offset, CSS_RULES.restyle, `${property} on ${host} restyles it; app CSS may only place Aster elements (size, position, grid and flex placement).`);
    const plain = value.replace(/"[^"]*"|'[^']*'|url\([^)]*\)/g, m => " ".repeat(m.length));
    for (const match of plain.matchAll(COLOUR)) {
      if (/^[a-z]+\(/i.test(match[0]) && /var\(/.test(match[0])) continue;
      report(offset, CSS_RULES.colour, `${property}: ${match[0]} is a fixed colour; use a theme token such as var(--aster-accent) or var(--aster-text-2).`);
      break;
    }
    if (!context.fontFace) {
      const v = value.trim();
      if (property === "font-family" && !/^(?:var\(|inherit|initial|unset)/.test(v)) report(offset, CSS_RULES.font, `font-family: ${v} bypasses the theme; use var(--aster-font-ui) or var(--aster-font-figure).`);
      if (property === "font-weight" && /^(?:\d+|bold|bolder|lighter)$/.test(v)) report(offset, CSS_RULES.font, `font-weight: ${v} bypasses the theme; use var(--aster-weight), var(--aster-weight-label) or var(--aster-weight-strong).`);
      if (property === "font" && !/var\(/.test(v) && SHAPE_FONT.test(v)) report(offset, CSS_RULES.font, `font: ${v} names a font family; use the theme's font tokens.`);
    }
  }
}
