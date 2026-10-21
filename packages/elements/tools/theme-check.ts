import { TOKEN_NAMES } from "../src/styles/contract.ts";

/** A colour as gamma-encoded sRGB channels and alpha, each 0–1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** One identity in a theme file: its light values, and the dark scheme's overrides. */
export interface Identity {
  /** The `data-identity` value; empty for the default identity (plain `:root`). */
  readonly name: string;
  readonly light: ReadonlyMap<string, string>;
  readonly dark: ReadonlyMap<string, string>;
}

export interface Finding {
  readonly scheme: "light" | "dark" | "both";
  readonly message: string;
}

export interface Report {
  readonly identity: string;
  readonly errors: readonly Finding[];
  readonly warnings: readonly Finding[];
}

/**
 * Pairs whose contrast must hold, as [foreground, background, minimum].
 * 4.5:1 is WCAG's for text, 3:1 for marks, focus and indicators. All three
 * text tiers carry text people read (headers, labels, timestamps).
 */
export const PAIRS: readonly (readonly [string, string, number])[] = [
  ["text", "surface", 4.5],
  ["text", "page", 4.5],
  ["text", "sunk", 4.5],
  ["text-2", "surface", 4.5],
  ["text-2", "sunk", 4.5],
  ["text-2", "page", 4.5],
  ["text-3", "surface", 4.5],
  ["text-3", "page", 4.5],
  ["text", "accent-soft", 4.5],
  ["text-2", "accent-soft", 4.5],
  ["text-3", "accent-soft", 4.5],
  ["accent", "surface", 4.5],
  ["on-accent", "accent", 4.5],
  ["on-accent", "accent-hi", 4.5],
  ["negative", "surface", 4.5],
  ["positive", "surface", 3],
  ["caution", "surface", 3],
  ["focus", "surface", 3],
  ["indicator", "surface", 3],
  ["toast-text", "toast-bg", 4.5],
  ["toast-action", "toast-bg", 4.5],
];

/** The identities a theme file defines, from its `:root` rules. */
export function identities(css: string): Identity[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Map<string, { light: Map<string, string>; dark: Map<string, string> }>();
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.trim();
    if (selector.startsWith("@") || !selector.includes(":root")) continue;
    const name = /\[data-identity="([^"]+)"\]/.exec(selector)?.[1] ?? "";
    const dark = /\[data-scheme="dark"\]/.test(selector);
    let entry = found.get(name);
    if (!entry) found.set(name, (entry = { light: new Map(), dark: new Map() }));
    for (const d of declarations(m[2]!)) (dark ? entry.dark : entry.light).set(d[0], d[1]);
  }
  return [...found].map(([name, e]) => ({ name, light: e.light, dark: e.dark }));
}

function declarations(body: string): [string, string][] {
  // Values can hold semicolons only inside url("…"), which themes quote.
  const out: [string, string][] = [];
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*((?:url\("[^"]*"\)|[^;])+);?/g)) out.push([m[1]!, m[2]!.trim()]);
  return out;
}

/** Checks one identity against the contract and the contrast pairs. */
export function check(identity: Identity): Report {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const known = new Set(TOKEN_NAMES);
  const missing = TOKEN_NAMES.filter((t) => !identity.light.has(t));
  if (missing.length) errors.push({ scheme: "light", message: `missing ${missing.join(", ")}` });
  for (const [scheme, values] of [["light", identity.light], ["dark", identity.dark]] as const) {
    const unknown = [...values.keys()].filter((t) => t.startsWith("--aster-") && !known.has(t));
    if (unknown.length) errors.push({ scheme, message: `not in the contract (misspelt?): ${unknown.join(", ")}` });
  }
  const schemes: ["light" | "dark", Map<string, string>][] = [["light", new Map(identity.light)]];
  if (identity.dark.size) schemes.push(["dark", new Map([...identity.light, ...identity.dark])]);
  for (const [scheme, values] of schemes) {
    for (const [fg, bg, min] of PAIRS) {
      const background = resolve(values, `--aster-${bg}`, new Set());
      const foreground = resolve(values, `--aster-${fg}`, new Set());
      if (!background || !foreground) {
        const which = [!foreground ? fg : "", !background ? bg : ""].filter(Boolean).join(" and ");
        warnings.push({ scheme, message: `can't evaluate ${which} to check ${fg} on ${bg}` });
        continue;
      }
      // A translucent background sits on the surface; a translucent foreground on its background.
      const surface = resolve(values, "--aster-surface", new Set()) ?? WHITE;
      const under = over(background, over(surface, WHITE));
      const ratio = contrast(over(foreground, under), under);
      if (ratio + 1e-9 < min) errors.push({ scheme, message: `${fg} on ${bg} is ${ratio.toFixed(2)}:1; needs ${min}:1` });
    }
  }
  return { identity: identity.name || "default", errors, warnings };
}

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };

function resolve(values: ReadonlyMap<string, string>, name: string, seen: Set<string>): Rgba | undefined {
  if (seen.has(name)) return undefined;
  seen.add(name);
  const value = values.get(name);
  return value === undefined ? undefined : parseColor(value, (n) => resolve(values, n, new Set(seen)));
}

/** A CSS colour, or undefined for syntax this checker doesn't evaluate. */
export function parseColor(text: string, lookup: (name: string) => Rgba | undefined = () => undefined): Rgba | undefined {
  const t = text.trim();
  const v = /^var\((--[\w-]+)\)$/.exec(t);
  if (v) return lookup(v[1]!);
  if (t === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,8})$/i.exec(t)?.[1];
  if (hex) return parseHex(hex);
  const fn = /^([a-z-]+)\((.*)\)$/is.exec(t);
  if (!fn) return undefined;
  const [, name, args] = fn as unknown as [string, string, string];
  switch (name.toLowerCase()) {
    case "rgb":
    case "rgba": {
      const n = args.split(/[\s,/]+/).filter(Boolean).map((p) => (p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p)));
      if (n.length < 3 || n.some(Number.isNaN)) return undefined;
      return { r: n[0]! / 255, g: n[1]! / 255, b: n[2]! / 255, a: n[3] ?? 1 };
    }
    case "oklch":
      return oklch(args, lookup);
    case "color-mix":
      return colorMix(args, lookup);
    default:
      return undefined;
  }
}

function parseHex(h: string): Rgba | undefined {
  const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  if (full.length !== 6 && full.length !== 8) return undefined;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) : 1 };
}

function oklch(args: string, lookup: (name: string) => Rgba | undefined): Rgba | undefined {
  const [main, alphaText] = splitAlpha(args);
  const alpha = alphaText === undefined ? undefined : number(alphaText);
  const from = /^from\s+(var\([^)]*\)|#[0-9a-f]+|\w+\([^)]*\))\s+(.*)$/i.exec(main);
  if (from) {
    const base = parseColor(from[1]!, lookup);
    if (!base) return undefined;
    const [l, c, h] = toOklch(base);
    const parts = splitTop(from[2]!);
    if (parts.length !== 3) return undefined;
    const channel = (p: string, own: number, key: string) => {
      if (p === key) return own;
      const calc = new RegExp(`^calc\\(${key}\\s*([+-])\\s*([\\d.]+)\\)$`).exec(p);
      return calc ? own + (calc[1] === "+" ? 1 : -1) * Number(calc[2]) : number(p);
    };
    const L = channel(parts[0]!, l, "l");
    const C = channel(parts[1]!, c, "c");
    const H = channel(parts[2]!, h, "h");
    if ([L, C, H].some((x) => x === undefined || Number.isNaN(x))) return undefined;
    return { ...fromOklch(L!, C!, H!), a: alpha ?? base.a };
  }
  const parts = main.split(/\s+/).filter(Boolean);
  if (parts.length !== 3) return undefined;
  const L = parts[0]!.endsWith("%") ? parseFloat(parts[0]!) / 100 : number(parts[0]!);
  const C = number(parts[1]!);
  const H = parts[2] === "none" ? 0 : number(parts[2]!);
  if ([L, C, H, alpha].some((x) => x !== undefined && Number.isNaN(x)) || L === undefined || C === undefined || H === undefined) return undefined;
  return { ...fromOklch(L, C, H), a: alpha ?? 1 };
}

function colorMix(args: string, lookup: (name: string) => Rgba | undefined): Rgba | undefined {
  const parts = splitTop(args, ",");
  if (parts.length !== 3 || parts[0]!.trim() !== "in srgb") return undefined;
  const item = (p: string) => {
    const m = /^(.*?)\s+([\d.]+)%$/.exec(p.trim());
    return { color: parseColor(m ? m[1]! : p, lookup), pct: m ? Number(m[2]) / 100 : undefined };
  };
  const a = item(parts[1]!);
  const b = item(parts[2]!);
  if (!a.color || !b.color) return undefined;
  const pa = a.pct ?? (b.pct === undefined ? 0.5 : 1 - b.pct);
  const pb = b.pct ?? 1 - pa;
  // Premultiplied, as CSS mixes.
  const alpha = a.color.a * pa + b.color.a * pb;
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (x: number, y: number) => (x * a.color!.a * pa + y * b.color!.a * pb) / alpha;
  return { r: mix(a.color.r, b.color.r), g: mix(a.color.g, b.color.g), b: mix(a.color.b, b.color.b), a: alpha };
}

function splitAlpha(args: string): [string, string | undefined] {
  let depth = 0;
  for (let i = args.length - 1; i >= 0; i--) {
    const ch = args[i];
    if (ch === ")") depth++;
    else if (ch === "(") depth--;
    else if (ch === "/" && depth === 0) return [args.slice(0, i).trim(), args.slice(i + 1).trim()];
  }
  return [args.trim(), undefined];
}

function splitTop(text: string, sep = " "): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function number(p: string): number | undefined {
  const n = p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p);
  return Number.isNaN(n) ? undefined : n;
}

// OKLab ↔ linear sRGB (Björn Ottosson's matrices), gamut-clipped.
function fromOklch(L: number, C: number, H: number): Omit<Rgba, "a"> {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => encode(Math.min(1, Math.max(0, x))));
  return { r: lin[0]!, g: lin[1]!, b: lin[2]! };
}

function toOklch(c: Rgba): [number, number, number] {
  const [r, g, b] = [decode(c.r), decode(c.g), decode(c.b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

const decode = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

/** `top` composited over an opaque `bottom`, in sRGB as browsers blend. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (x: number, y: number) => x * top.a + y * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

/** WCAG 2 contrast ratio of two opaque colours. */
export function contrast(a: Rgba, b: Rgba): number {
  const lum = (c: Rgba) => 0.2126 * decode(c.r) + 0.7152 * decode(c.g) + 0.0722 * decode(c.b);
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
