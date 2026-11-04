import { signal } from "@preact/signals-core";
import { DataContext, type Entity } from "@getaster/data";
import { AsterElement, define, type BreadcrumbItem, type CellRenderer, type Expansion, type ExpansionEditor, type Grid, type GridView, type RowControl, type RowState, type SectionChrome, type View } from "@getaster/elements";
import { createMockService } from "@getaster/mock";
import { html, nothing, svg } from "lit-html";
import { ref } from "lit-html/directives/ref.js";
import { repeat } from "lit-html/directives/repeat.js";
import { icons } from "../../icons.ts";
import doc from "./helpdesk-model.json";

// The spike model, rendered read-only so the authored vocabulary can be looked
// at as a screen rather than a spec. The JSON beside this file is the compiled
// form of the spike YAML (the browser loads no YAML parser); re-compile it when
// the model changes.

type Value = unknown;
type Criterion = string | boolean | CritNode;
interface CritNode {
  op: string;
  field?: string;
  value?: Value;
  values?: Value[];
  args?: Criterion[];
  arg?: Criterion;
  where?: Criterion;
  ge?: Value;
  gt?: Value;
  le?: Value;
  lt?: Value;
  caseInsensitive?: boolean;
}
interface Computed {
  language?: string;
  formula?: string;
}
interface FieldDef {
  type?: string;
  ref?: string;
  many?: boolean;
  owned?: boolean;
  required?: boolean;
  unique?: boolean;
  default?: Value;
  requiredWhen?: Criterion;
  computed?: Computed;
}
interface TransitionAction {
  action: string;
  from: string[];
  to: string;
  requires?: Criterion;
  set?: Record<string, Value>;
}
interface TypeDef {
  id?: string;
  inherits?: string;
  mixins?: string[];
  behaviours?: string[];
  readOnly?: boolean;
  fields?: Record<string, FieldDef>;
  transitions?: { field: string; actions: TransitionAction[] }[];
}
interface CustomType {
  base: string;
  pattern?: string;
  validate?: string;
}
interface Reaction {
  name: string;
  on: string;
  guard: Criterion;
  action: string;
}
interface HelpdeskModel {
  id: string;
  name: string;
  version: string;
  enums: Record<string, string[]>;
  customTypes: Record<string, CustomType>;
  mixins: Record<string, { fields: Record<string, FieldDef> }>;
  criteria: Record<string, Criterion>;
  types: Record<string, TypeDef>;
  security: { roles: string[]; rows?: Record<string, Record<string, Criterion>> };
  reactions: Reaction[];
}

const m = (doc as { model?: HelpdeskModel }).model;

type HdmView = "overview" | "types" | "criteria" | "security" | "reactions" | "enums";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "types", label: "Types" },
  { value: "criteria", label: "Criteria" },
  { value: "security", label: "Security" },
  { value: "reactions", label: "Reactions" },
  { value: "enums", label: "Enums & custom types" },
] as const;

const chip = (text: string) => html`<span class="hdm-chip">${text}</span>`;
const val = (v: Value) => html`<code class="hdm-val">${String(v)}</code>`;
const quiet = (text: string) => html`<span class="hdm-quiet">${text}</span>`;

/** One compact window-grid glyph: an icon with its meaning as tooltip and accessible name. */
const glyph = (icon: View, title: string) =>
  html`<span class="hdm-glyph" role="img" aria-label=${title} title=${title}>${icon}</span>`;

/** The window grids' type glyphs, keyed by the model's dataType spelling; anything else is an enum. */
const TYPE_GLYPH: Readonly<Record<string, readonly [View, string]>> = {
  text: [icons.typeText("Aa"), "text"],
  integer: [icons.typeText("#"), "number"],
  boolean: [icons.boolean, "boolean"],
  timestamp: [icons.time, "timestamp"],
  computed: [icons.typeText("ƒ"), "computed"],
  EmailAddress: [icons.typeText("Aa"), "EmailAddress"],
  HexColor: [icons.swatch, "HexColor"],
  SanitizedHtml: [icons.brackets, "sanitised HTML"],
};

const FLAG_GLYPH: Readonly<Record<string, readonly [View, string]>> = {
  required: [icons.required, "required"],
  unique: [icons.unique, "unique"],
  owned: [icons.owned, "owned"],
};
const fld = (name: string) => html`<code class="hdm-field">${name}</code>`;

/** A literal, the request fact {criteria: user}, or a transition's now. */
function valueView(v: Value): View {
  if (v === null || v === undefined) return html`<span class="hdm-chip hdm-empty">blank</span>`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.criteria === "user") return html`<span class="hdm-chip hdm-user">the user</span>`;
    if (o.now === true) return html`<span class="hdm-chip hdm-now">now</span>`;
    return val(JSON.stringify(v));
  }
  if (typeof v === "boolean") return chip(String(v));
  if (typeof v === "number") return val(v);
  return val(`"${v}"`);
}

// ── the model as display data ──

interface FieldRow {
  name: string;
  def: FieldDef;
  from?: string; // "mixin Taggable" or "inherits Principal"
}

/** A type's declarative fields: own, then mixins, then inherited — each with its source. */
function declaredFields(t: TypeDef, model: HelpdeskModel, seen = new Set<string>()): FieldRow[] {
  const out: FieldRow[] = [];
  const put = (name: string, def: FieldDef, from?: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    out.push(from === undefined ? { name, def } : { name, def, from });
  };
  for (const [name, def] of Object.entries(t.fields ?? {})) if (def.computed === undefined) put(name, def);
  for (const mx of t.mixins ?? [])
    for (const [name, def] of Object.entries(model.mixins[mx]?.fields ?? {})) put(name, def, `mixin ${mx}`);
  if (t.inherits !== undefined) {
    const parent = model.types[t.inherits];
    // Fresh set for the parent call: the parent dedups internally, and the outer
    // `put` (not the parent's) claims the names here, so the source marker survives.
    if (parent !== undefined) for (const f of declaredFields(parent, model)) put(f.name, f.def, f.from ?? `inherits ${t.inherits}`);
  }
  return out;
}

/** A type's computed fields (own and via mixins). */
function computedFields(t: TypeDef, model: HelpdeskModel): FieldRow[] {
  const out: FieldRow[] = [];
  const seen = new Set<string>();
  for (const [name, def] of Object.entries(t.fields ?? {})) {
    if (def.computed === undefined) continue;
    out.push({ name, def });
    seen.add(name);
  }
  for (const mx of t.mixins ?? [])
    for (const [name, def] of Object.entries(model.mixins[mx]?.fields ?? {}))
      if (def.computed !== undefined && !seen.has(name)) out.push({ name, def, from: `mixin ${mx}` });
  return out;
}

/** The type a field of `root` points to (for via/any/all context), if any. */
function refType(root: string, field: string): string | undefined {
  if (m === undefined) return undefined;
  const t = m.types[root];
  if (t === undefined) return undefined;
  return declaredFields(t, m).find((r) => r.name === field)?.def.ref;
}

/** Types in reading order: parents before children, children indented under them. */
function typeOrder(model: HelpdeskModel): { name: string; depth: number }[] {
  const out: { name: string; depth: number }[] = [];
  const walk = (name: string, depth: number): void => {
    out.push({ name, depth });
    for (const [n, t] of Object.entries(model.types)) if (t.inherits === name) walk(n, depth + 1);
  };
  for (const [n, t] of Object.entries(model.types)) if (t.inherits === undefined) walk(n, 0);
  return out;
}

// ── the model as rows, served by a page-local mock OData service ──
//
// The showcase ships a compiled form of the model as a JSON document; the
// grids below read it through aster-grid's own data layer, so the spike
// renders the model the way the product would serve it, and every reload
// regenerates the rows from the compiled YAML.

interface HdmFieldRow {
  id: string;
  typeId: string;
  typeName: string;
  section: string;
  position: number;
  name: string;
  source: string | null;
  dataType: string;
  refId: string | null;
  flags: string;
  rule: string | null;
  language: string | null;
  formula: string | null;
}

/** A type's relationships: its base (unless a root), then each ref field. */
function relationshipsOf(t: TypeDef, model: HelpdeskModel): { label: string; target: string; many: boolean }[] {
  return [
    ...(t.inherits !== undefined ? [{ label: "extends", target: t.inherits, many: false }] : []),
    ...declaredFields(t, model)
      .filter((f) => f.def.ref !== undefined)
      .map((f) => ({ label: f.name, target: f.def.ref!, many: f.def.many === true })),
  ];
}

/** One display set: every type's fields (declared then derived). */
function hdmRows(model: HelpdeskModel): { Fields: HdmFieldRow[] } {
  const fields: HdmFieldRow[] = [];
  for (const { name } of typeOrder(model)) {
    const t = model.types[name]!;
    let fpos = 0;
    for (const { name: fname, def, from } of declaredFields(t, model)) {
      fields.push({
        id: `${name}.${fname}`,
        typeId: name,
        typeName: name,
        // "Declared" so the group keys sort with this group first.
        section: "Declared fields",
        position: fpos++,
        name: fname,
        source: from ?? null,
        dataType: def.ref ?? def.type ?? "?",
        refId: def.ref ?? null,
        flags: JSON.stringify(FLAGS.filter(([k]) => def[k] === true).map(([, label]) => label)),
        rule: JSON.stringify({ when: def.requiredWhen, default: def.default }),
        language: null,
        formula: null,
      });
    }
    for (const { name: fname, def, from } of computedFields(t, model)) {
      fields.push({
        id: `${name}.${fname}`,
        typeId: name,
        typeName: name,
        section: "Derived fields",
        position: fpos++,
        name: fname,
        source: from ?? null,
        dataType: "computed",
        refId: null,
        flags: "[]",
        rule: null,
        language: def.computed?.language ?? "sql",
        formula: def.computed?.formula ?? "",
      });
    }
  }
  return { Fields: fields };
}

/** Minimal CSDL for the fields set. */
const HDM_METADATA = {
  $Version: "4.01",
  $EntityContainer: "Hdm.Container",
  Hdm: {
    Field: {
      $Kind: "EntityType",
      $Key: ["id"],
      id: { $Type: "Edm.String" },
      typeId: { $Type: "Edm.String" },
      typeName: { $Type: "Edm.String" },
      section: { $Type: "Edm.String" },
      position: { $Type: "Edm.Int32" },
      name: { $Type: "Edm.String" },
      source: { $Type: "Edm.String", $Nullable: true },
      dataType: { $Type: "Edm.String" },
      refId: { $Type: "Edm.String", $Nullable: true },
      flags: { $Type: "Edm.String" },
      rule: { $Type: "Edm.String", $Nullable: true },
      language: { $Type: "Edm.String", $Nullable: true },
      formula: { $Type: "Edm.String", $Nullable: true },
    },
    Container: {
      $Kind: "EntityContainer",
      Fields: { $Collection: true, $Type: "Hdm.Field" },
    },
  },
};

const HDM_FIELDS_VIEW: GridView = {
  columns: [
    { field: "name", width: 180 },
    { field: "source", width: 150 },
    { field: "dataType", width: 140 },
    { field: "flags", width: 170 },
    { field: "rule" },
  ],
  sort: [{ field: "position" }],
  filters: {},
  frozen: 1,
  groupBy: "section",
};

// ── the family-tree layout ──
//
// Each root type heads a family: the root at one row, its children on the row
// below (left to right, the root centred over them). Families flow left to
// right across a band and wrap onto further bands; each band is two rows tall,
// so children always sit directly under their parent and the elbow edges
// between them can never cross.

const WIN_W = 240; // window width
const WIN_GAP_X = 40; // gap between windows in a row
const WIN_BAR_H = 43; // collapsed window height (section bar + borders)
const WIN_OPEN_H = 283; // expanded window height (bar + meta line + fields grid)
const WIN_CHROME: SectionChrome = Object.freeze({ titleBar: true, status: "always" });
const ROW_H = 320; // vertical pitch between rows
const CANVAS_MAX_W = 1500; // wrap families past this width

interface WinPos {
  x: number;
  y: number;
}

/** Window heights differ (collapsed/expanded), so the node's current bottom. */
const winH = (expanded: ReadonlySet<string>, name: string): number => (expanded.has(name) ? WIN_OPEN_H : WIN_BAR_H);

interface HdmLayout {
  pos: Map<string, WinPos>;
  edges: { from: string; to: string }[];
  width: number;
  height: number;
}

function layoutForest(model: HelpdeskModel): HdmLayout {
  const kidsOf = (name: string): string[] =>
    Object.entries(model.types)
      .filter(([, t]) => t.inherits === name)
      .map(([n]) => n);
  const roots = Object.entries(model.types)
    .filter(([, t]) => t.inherits === undefined)
    .map(([n]) => n);
  // A family is one root's subtree, its width the widest level in it.
  const levels = (root: string): string[][] => {
    const out: string[][] = [];
    let row = [root];
    while (row.length > 0) {
      out.push(row);
      row = row.flatMap(kidsOf);
    }
    return out;
  };
  const pos = new Map<string, WinPos>();
  const edges: { from: string; to: string }[] = [];
  let x = 24;
  let bandY = 8;
  let bandRows = 0;
  let maxX = 0;
  for (const root of roots) {
    const rows = levels(root);
    const fw = Math.max(...rows.map((row) => row.length * (WIN_W + WIN_GAP_X) - WIN_GAP_X));
    if (x + fw > CANVAS_MAX_W) {
      x = 24;
      bandY += bandRows * ROW_H + 24;
      bandRows = 0;
    }
    rows.forEach((row, d) => {
      const span = row.length * (WIN_W + WIN_GAP_X) - WIN_GAP_X;
      row.forEach((n, i) => {
        pos.set(n, { x: x + (fw - span) / 2 + i * (WIN_W + WIN_GAP_X), y: bandY + d * ROW_H });
        for (const k of kidsOf(n)) edges.push({ from: n, to: k });
      });
    });
    bandRows = Math.max(bandRows, rows.length);
    x += fw + WIN_GAP_X;
    maxX = Math.max(maxX, x - WIN_GAP_X);
  }
  return {
    pos,
    edges,
    width: maxX + 8,
    height: bandY + bandRows * ROW_H + 8,
  };
}

// ── the neighbourhood layout ──
//
// Selecting a type with relationships centres it and lays its neighbourhood
// out fresh: the selection's inheritance parents hang in a chain directly
// above it, everything else goes into two columns (left and right), each
// extends-connected fragment laid out as a mini family tree so parents sit
// above children and inheritance elbows cannot cross. Relationship edges are
// orthogonal: a hub edge exits the hub's side, travels a corridor lane, and
// branches into the target's free side; same-column and cross-side edges use
// the outer lanes and a top band. Lane and band slots are assigned in edge
// order, so the layout is deterministic per (selection, expansion).

const HOOD_MIN_W = 1140; // canvas width floor
const HOOD_MIN_H = 760; // canvas height floor
const HOOD_MARGIN = 80; // canvas edge to column outer edge
const HOOD_GAP = 128; // hub side to column inner edge (the inner corridors)
const HOOD_VGAP = 48; // vertical gap between column rows
const HOOD_LANE = 8; // horizontal pitch between corridor lanes
const HOOD_BAND_Y = 8; // top bypass band for cross-side hops
const HOOD_BAND_STEP = 4; // pitch between band lanes

interface HdmRoute {
  kind: "solid" | "dash";
  pts: number[]; // flat x,y pairs
  label?: string;
  lx: number;
  ly: number;
}

interface HdmHood {
  pos: Map<string, WinPos>;
  visible: ReadonlySet<string>;
  routes: HdmRoute[];
  width: number;
  height: number;
}

/** A type with graph relationships (ref fields) — the ones that can centre a neighbourhood. */
function hasGraphRels(name: string, model: HelpdeskModel): boolean {
  return relationshipsOf(model.types[name]!, model).some((r) => r.label !== "extends");
}

/** The neighbourhood of a selection: selected types, their graph targets, and every member's inheritance parents (transitively). */
function hoodSet(stack: readonly string[], model: HelpdeskModel): Set<string> {
  const V = new Set(stack);
  for (const n of stack) {
    const t = model.types[n];
    if (t === undefined) continue;
    for (const r of relationshipsOf(t, model)) V.add(r.target);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of [...V]) {
      const p = model.types[n]?.inherits;
      if (p !== undefined && !V.has(p)) {
        V.add(p);
        changed = true;
      }
    }
  }
  return V;
}

function layoutHood(model: HelpdeskModel, stack: readonly string[], expanded: ReadonlySet<string>): HdmHood {
  const V = hoodSet(stack, model);
  const hub = stack[stack.length - 1]!;
  const pos = new Map<string, WinPos>();
  const routes: HdmRoute[] = [];

  // The hub's inheritance parents hang in a chain directly above it.
  const chain: string[] = [];
  for (let p = model.types[hub]?.inherits; p !== undefined && V.has(p); p = model.types[p]?.inherits) chain.push(p);
  const chainH = chain.reduce((s, n) => s + winH(expanded, n) + HOOD_VGAP, 0);

  // Everything else groups into columns: extends-connected fragments laid out
  // as mini family trees, so parents sit above their children.
  const rest = [...V].filter((n) => n !== hub && !chain.includes(n));
  const restSet = new Set(rest);
  const kidsOf = (n: string): string[] => rest.filter((x) => model.types[x]?.inherits === n);
  const depth = (n: string): number => {
    let d = 0;
    for (let p = model.types[n]?.inherits; p !== undefined && restSet.has(p); p = model.types[p]?.inherits) d++;
    return d;
  };
  const frags: string[][] = [];
  for (const n of rest) {
    const p = model.types[n]?.inherits;
    if (p !== undefined && restSet.has(p)) continue; // not a fragment root
    const frag: string[] = [];
    const q = [n];
    while (q.length > 0) {
      const c = q.shift()!;
      frag.push(c);
      q.push(...kidsOf(c));
    }
    frag.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
    frags.push(frag);
  }
  frags.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));

  interface FragBox {
    rows: string[][];
    x: number;
    y: number;
    w: number;
    h: number;
  }
  const fragOf = new Map<string, FragBox>();
  const layFrag = (frag: string[]): FragBox => {
    const rows: string[][] = [];
    let row = [frag[0]!];
    while (row.length > 0) {
      rows.push(row);
      row = row.flatMap(kidsOf).sort((a, b) => a.localeCompare(b));
    }
    const w = Math.max(...rows.map((r) => r.length * (WIN_W + WIN_GAP_X) - WIN_GAP_X));
    const rowY: number[] = [];
    let y = 0;
    for (const r of rows) {
      rowY.push(y);
      y += Math.max(...r.map((n) => winH(expanded, n))) + HOOD_VGAP;
    }
    const box: FragBox = { rows, x: 0, y: 0, w, h: y - HOOD_VGAP };
    rows.forEach((r, d) => {
      const span = r.length * (WIN_W + WIN_GAP_X) - WIN_GAP_X;
      r.forEach((n, i) => {
        const p = { x: (w - span) / 2 + i * (WIN_W + WIN_GAP_X), y: rowY[d]! };
        pos.set(n, p);
        fragOf.set(n, box);
      });
    });
    return box;
  };
  const boxes = frags.map((f) => layFrag(f));

  // Balance fragments into the two columns by total height.
  const colL: FragBox[] = [];
  const colR: FragBox[] = [];
  const hOf = (col: FragBox[]): number => col.reduce((s, b) => s + b.h + HOOD_VGAP, 0);
  for (const box of boxes) if (hOf(colL) <= hOf(colR)) colL.push(box); else colR.push(box);
  const colLW = Math.max(0, ...colL.map((b) => b.w));
  const colRW = Math.max(0, ...colR.map((b) => b.w));

  // The hub sits just right of the left column (the wrap scrolls to centre it,
  // so the canvas itself need not be symmetric).
  const hubLeft = HOOD_MARGIN + colLW + HOOD_GAP;
  const width = Math.max(HOOD_MIN_W, hubLeft + WIN_W + HOOD_GAP + colRW + HOOD_MARGIN);
  const height = Math.max(HOOD_MIN_H, hOf([...colL, ...colR]) - HOOD_VGAP + 96, winH(expanded, hub) + 2 * (chainH + HOOD_VGAP + 28));
  const cy = height / 2;
  const hubCx = hubLeft + WIN_W / 2;
  pos.set(hub, { x: hubLeft, y: cy - winH(expanded, hub) / 2 });

  let chainTop = pos.get(hub)!.y - HOOD_VGAP;
  for (const n of chain) {
    chainTop -= winH(expanded, n);
    pos.set(n, { x: hubLeft, y: chainTop });
    chainTop -= HOOD_VGAP;
  }

  const stackCol = (col: FragBox[], left: boolean): void => {
    const total = hOf(col);
    let y = cy - total / 2;
    for (const box of col) {
      const x0 = left ? HOOD_MARGIN : width - HOOD_MARGIN - box.w;
      for (const [n, p] of pos) if (fragOf.get(n) === box) pos.set(n, { x: p.x + x0, y: p.y + y });
      y += box.h + HOOD_VGAP;
    }
  };
  stackCol(colL, true);
  stackCol(colR, false);

  // ── edges ──
  // Routing keeps every horizontal inside a free band: the row gaps (row tops
  // sit HOOD_VGAP below the row above, and frag elbows run 24px above them),
  // the corridor between the columns and the hub, the corridor outside each
  // column, and the band above the chain. Targets are always dropped into
  // from their row gap, never entered through a sibling.
  const win = (n: string) => pos.get(n)!;
  const midY = (n: string) => win(n).y + winH(expanded, n) / 2;
  const zone = (n: string): "hub" | "top" | "L" | "R" =>
    n === hub ? "hub" : chain.includes(n) ? "top" : fragOf.get(n) !== undefined && colL.includes(fragOf.get(n)!) ? "L" : "R";

  const laneLBase = hubLeft - 60; // inner left corridor, lanes grow toward the hub
  const laneRBase = hubLeft + WIN_W + 60; // inner right corridor, lanes grow away
  const outerLBase = 52; // outer left corridor, lanes shrink toward the canvas edge
  const outerRBase = width - 52; // outer right corridor, lanes grow past the column
  const laneSlots = { laneL: 0, laneR: 0, outerL: 0, outerR: 0, band: 0 };
  const edgeK = new Map<string, number>(); // edges already into a target, for the stagger
  const kOf = (t: string): number => {
    const k = edgeK.get(t) ?? 0;
    edgeK.set(t, k + 1);
    return k;
  };
  const lane = (c: "laneL" | "laneR" | "outerL" | "outerR"): number => {
    const slot = laneSlots[c]++;
    const base = c === "laneL" ? laneLBase : c === "laneR" ? laneRBase : c === "outerL" ? outerLBase : outerRBase;
    return c === "laneL" || c === "laneR" ? base + slot * HOOD_LANE : c === "outerL" ? base - slot * HOOD_LANE : base + slot * HOOD_LANE;
  };
  const bandY = (): number => HOOD_BAND_Y + laneSlots.band++ * HOOD_BAND_STEP;

  // Hub exits: staggered on each side around the hub's middle, pre-counted so
  // the first edge is centred (the exit side faces the target's column).
  const hubExitCount = { L: 0, R: 0 };
  for (const r of relationshipsOf(model.types[hub]!, model))
    if (r.label !== "extends") hubExitCount[zone(r.target) === "R" ? "R" : "L"]++;
  const hubDone = { L: 0, R: 0 };
  const hubExit = (side: "L" | "R"): number => {
    const n = hubDone[side]++;
    const h = winH(expanded, hub);
    const top = win(hub).y + 8;
    const bottom = win(hub).y + h - 8;
    return Math.min(Math.max(cy + (n - (hubExitCount[side] - 1) / 2) * 14, top), bottom);
  };

  /** Finish a dashed edge by dropping into the target from its row gap. */
  const dropIn = (t: string, lx: number, pts: number[], label: string): void => {
    const k = kOf(t);
    const cx = win(t).x + WIN_W / 2 + (k % 2 === 1 ? 12 : k === 2 ? -12 : 0);
    const gy = win(t).y - 12;
    pts.push(lx, gy, cx, gy, cx, win(t).y);
    routes.push({ kind: "dash", pts, label, lx: (lx + cx) / 2, ly: gy - 6 - k * 10 });
  };

  const rel = (s: string, t: string, label: string): void => {
    const zs = zone(s);
    const zt = zone(t);
    const pts: number[] = [];
    if (zs === "hub") {
      const side: "L" | "R" = zt === "R" ? "R" : "L";
      const lx = lane(side === "L" ? "laneL" : "laneR");
      const y = hubExit(side);
      pts.push(side === "L" ? win(hub).x : win(hub).x + WIN_W, y, lx, y);
      if (zt === "top") {
        const k = kOf(t);
        const gy = win(t).y - 12;
        pts.push(lx, gy, hubCx, gy, hubCx, win(t).y);
        routes.push({ kind: "dash", pts, label, lx: (lx + hubCx) / 2, ly: gy - 6 - k * 10 });
      } else {
        dropIn(t, lx, pts, label);
      }
    } else if (zt === "hub") {
      const lefty = zs !== "R"; // L-zone and chain sources approach from the left
      const lx = lane(lefty ? "laneL" : "laneR");
      const k = kOf(hub);
      const h = winH(expanded, hub);
      const by = Math.min(Math.max(cy + k * 10, win(hub).y + 8), win(hub).y + h - 8);
      const hx = lefty ? win(hub).x : win(hub).x + WIN_W;
      pts.push(win(s).x + (zs === "L" ? WIN_W : 0), midY(s), lx, midY(s), lx, by, hx, by);
      routes.push({ kind: "dash", pts, label, lx: (lx + hx) / 2, ly: by - 6 });
    } else if (zs === zt) {
      // Same column: around its outer side. A source that is not the leftmost
      // of its row crosses a sibling with its stub — rare, and the drop still lands.
      const lefty = zs === "L";
      const lx = lane(lefty ? "outerL" : "outerR");
      pts.push(win(s).x + (lefty ? 0 : WIN_W), midY(s), lx, midY(s));
      dropIn(t, lx, pts, label);
    } else if (zs === "top" || zt === "top") {
      // Chain member ↔ column: up or down the inner corridor, then the row gap.
      // An expanded hub taller than the target's row gap can clip the crossing
      // horizontal — rare (chain members in this model have no refs) and accepted.
      const c: "laneL" | "laneR" = zs === "R" ? "laneR" : "laneL";
      const lx = lane(c);
      const k = kOf(t);
      const gy = win(t).y - 12;
      pts.push(win(s).x + (zs === "L" ? WIN_W : 0), midY(s), lx, midY(s), lx, gy, hubCx, gy, hubCx, win(t).y);
      routes.push({ kind: "dash", pts, label, lx: (lx + hubCx) / 2, ly: gy - 6 - k * 10 });
    } else {
      // Cross-side hop through the band above the chain.
      const ls = lane(zs === "L" ? "laneL" : "laneR");
      const lt = lane(zt === "L" ? "laneL" : "laneR");
      const by = bandY();
      pts.push(win(s).x + (zs === "L" ? WIN_W : 0), midY(s), ls, midY(s), ls, by, lt, by);
      dropIn(t, lt, pts, label);
    }
  };

  // Solid inheritance edges: the chain, and mini-tree elbows inside fragments.
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i]!;
    const below = i === 0 ? hub : chain[i - 1]!;
    routes.push({ kind: "solid", pts: [hubCx, win(p).y + winH(expanded, p), hubCx, win(below).y], lx: 0, ly: 0 });
  }
  for (const n of V) {
    if (n === hub || chain.includes(n)) continue; // the chain solids already connect these
    const p = model.types[n]?.inherits;
    if (p === undefined || !V.has(p)) continue;
    if (chain.includes(p)) {
      // Parent above the hub, child in a column: out the parent's side, down
      // the inner corridor, and into the child's row gap. If the child sits in
      // the right column and the hub is expanded past the child's row gap the
      // horizontal can clip the hub — rare, and the spike accepts it.
      const lx = lane(zone(n) === "R" ? "laneR" : "laneL");
      const gy = win(n).y - 12;
      const cx = win(n).x + WIN_W / 2;
      const x0 = zone(n) === "R" ? hubLeft + WIN_W : hubLeft;
      routes.push({ kind: "solid", pts: [x0, midY(p), lx, midY(p), lx, gy, cx, gy, cx, win(n).y], lx: 0, ly: 0 });
    } else if (zone(p) === zone(n)) {
      // Parent and child in the same fragment: elbow through the row gap.
      const pCx = win(p).x + WIN_W / 2;
      const cCx = win(n).x + WIN_W / 2;
      const mid = (win(p).y + winH(expanded, p) + win(n).y) / 2;
      routes.push({ kind: "solid", pts: [pCx, win(p).y + winH(expanded, p), pCx, mid, cCx, mid, cCx, win(n).y], lx: 0, ly: 0 });
    }
  }

  // Dashed relationship edges, hub first so its lanes take the inner slots.
  for (const s of [hub, ...stack.filter((n) => n !== hub)]) {
    for (const r of relationshipsOf(model.types[s]!, model)) {
      if (r.label === "extends") continue;
      rel(s, r.target, r.many ? `${r.label} · many` : r.label);
    }
  }

  return { pos, visible: V, routes, width, height };
}

/** One context per page load, over the rows regenerated from the compiled model. */
let hdmContext: Promise<DataContext> | undefined;
function hdmCtx(): Promise<DataContext> {
  hdmContext ??= createMockService({
    metadata: HDM_METADATA,
    data: m === undefined ? {} : hdmRows(m),
    wasm: new URL("odata_mock.wasm", document.baseURI),
  }).then((service) => DataContext.connect(service.transport));
  return hdmContext;
}

// ── criteria as sentences ──

const OP_WORDS: Record<string, string> = {
  eq: "=",
  ne: "≠",
  gt: ">",
  ge: "≥",
  lt: "<",
  le: "≤",
  contains: "contains",
  startswith: "starts with",
  endswith: "ends with",
};

interface SentCtx {
  root: string;
  go: (name: string) => void;
}

const refChip = (name: string, go: (n: string) => void) =>
  html`<span class="hdm-chip hdm-ref" role="link" tabindex="0" @click=${() => go(name)}
    @keydown=${(e: KeyboardEvent) => (e.key === "Enter" || e.key === " " ? (e.preventDefault(), go(name)) : nothing)}
    >${name}</span>`;

/**
 * A criterion as one readable sentence. At via/any/all the hop names the record
 * it lands on — "(Inbox)" in "via its channel (Inbox): channel = email" — so the
 * inner fields are read against the related record, not the outer one.
 */
function sent(c: Criterion, ctx: SentCtx, nested = false): View {
  if (typeof c === "string") return refChip(c, ctx.go);
  if (typeof c === "boolean") return chip(c ? "always" : "never");
  const n = c as CritNode;
  const word = (w: string) => html`<span class="hdm-sent-word">${w}</span>`;
  switch (n.op) {
    case "and":
    case "or": {
      const kids = (n.args ?? []).map((a) => sent(a, ctx, true));
      if (!kids.length) return quiet("—");
      const joined: View[] = [];
      kids.forEach((k, i) => {
        if (i) joined.push(word(n.op === "and" ? "and" : "or"));
        joined.push(k);
      });
      return html`<span class="hdm-sent">${nested ? word("(") : nothing}${joined}${nested ? word(")") : nothing}</span>`;
    }
    case "not":
      return html`<span class="hdm-sent">${word("not")}${sent(n.arg ?? false, ctx, true)}</span>`;
    case "any":
    case "all":
    case "via": {
      const rt = n.field !== undefined ? refType(ctx.root, n.field) : undefined;
      const where = n.where === undefined || n.where === true ? undefined : n.where === false ? "never" : n.where;
      return html`<span class="hdm-sent">${word(n.op === "via" ? "via" : n.op === "any" ? "any of" : "all of")}
        ${word("its")}${fld(n.field ?? "?")}<span class="hdm-ctx">${rt ?? "?"}</span>
        ${where === undefined ? nothing : where === "never" ? chip("never") : html`${word(":")}${sent(where, { root: rt ?? "?", go: ctx.go })}`}</span>`;
    }
    case "between": {
      const low = n.ge !== undefined ? html`${word("≥")}${valueView(n.ge)}` : n.gt !== undefined ? html`${word(">")}${valueView(n.gt)}` : quiet("—");
      const high = n.le !== undefined ? html`${word("≤")}${valueView(n.le)}` : n.lt !== undefined ? html`${word("<")}${valueView(n.lt)}` : quiet("—");
      return html`<span class="hdm-sent">${fld(n.field ?? "?")}${word("between")}${low}${word("and")}${high}</span>`;
    }
    case "in":
      return html`<span class="hdm-sent">${fld(n.field ?? "?")}${word("in")}
        <span class="hdm-parens">(</span><span class="hdm-in">${(n.values ?? []).map((v) => valueView(v))}</span><span class="hdm-parens">)</span></span>`;
    case "blank":
      return html`<span class="hdm-sent">${fld(n.field ?? "?")}${word("is blank")}</span>`;
    default:
      return html`<span class="hdm-sent">${fld(n.field ?? "?")}${word(OP_WORDS[n.op] ?? n.op)}${valueView(n.value)}
        ${n.caseInsensitive ? chip("Aa") : nothing}</span>`;
  }
}

/** Where each named criterion is applied: the record type its fields read against. */
function criterionRoots(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  if (m === undefined) return used;
  const queue: [string, string][] = [];
  const note = (name: string, root: string): void => {
    const s = used.get(name) ?? new Set<string>();
    if (s.has(root)) return;
    s.add(root);
    used.set(name, s);
    queue.push([name, root]);
  };
  const walk = (c: Criterion, root: string): void => {
    if (typeof c === "string") {
      note(c, root);
      return;
    }
    if (typeof c === "boolean") return;
    const n = c as CritNode;
    if ((n.op === "any" || n.op === "all" || n.op === "via") && n.field !== undefined) {
      if (typeof n.where === "string") note(n.where, refType(root, n.field) ?? "?");
      else if (typeof n.where === "object") walk(n.where, refType(root, n.field) ?? "?");
    } else {
      for (const a of n.args ?? []) walk(a, root);
      if (n.arg !== undefined) walk(n.arg, root);
    }
  };
  for (const [type, byRole] of Object.entries(m.security.rows ?? {}))
    for (const c of Object.values(byRole)) if (typeof c !== "boolean") walk(c, type);
  for (const [type, t] of Object.entries(m.types)) {
    for (const f of Object.values(t.fields ?? {})) if (f.requiredWhen !== undefined) walk(f.requiredWhen, type);
    for (const machine of t.transitions ?? []) for (const a of machine.actions) if (a.requires !== undefined) walk(a.requires, type);
  }
  for (const r of m.reactions) walk(r.guard, r.on.split(".")[0]!);
  while (queue.length) {
    const [name, root] = queue.shift()!;
    const body = m.criteria[name];
    if (typeof body === "object" && body !== null) walk(body, root);
  }
  return used;
}

// ── the page ──

/** A read-only look at the authored model, beside the CAVR information model page. */
export class HelpdeskPage extends AsterElement {
  readonly #view = signal<HdmView>("overview");
  readonly #type = signal("Ticket");
  readonly #crit = signal<string | undefined>(undefined);
  readonly #ctx = signal<DataContext | undefined>(undefined);

  override connectedCallback(): void {
    super.connectedCallback();
    void hdmCtx().then((ctx) => (this.#ctx.value = ctx));
  }

  #goCrit(name: string): void {
    this.#view.value = "criteria";
    this.#crit.value = name;
    requestAnimationFrame(() => this.querySelector(`#crit-${name}`)?.scrollIntoView({ block: "center" }));
  }

  #openType(name: string): void {
    this.#view.value = "types";
    this.#type.value = name;
  }

  #fieldsGrid(): Grid | null {
    return this.querySelector<Grid>("aster-grid.hdm-fields-grid");
  }

  /** Groups render collapsed; open both once the grouping model is ready. */
  #onFieldsGrid = (el: Element | undefined): void => {
    if (el !== undefined) void this.#openFieldGroups();
  };

  /**
   * Groups render collapsed, and the grouping model is rebuilt (collapsed) each
   * time the grid's base changes, so keep opening until both are open.
   */
  async #openFieldGroups(frames = 200): Promise<void> {
    for (let i = 0; i < frames; i++) {
      const g = this.#fieldsGrid()?.groupingModel;
      if (g !== undefined) {
        const want = ['g:["Declared fields"]', 'g:["Derived fields"]'];
        if (want.every((id) => g.open.peek().has(id))) return;
        for (const id of want) await g.expand(id);
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  /** The JSON-array text cells (behaviours, mixins, flags) as chips. */
  #jsonChips(v: unknown): View {
    try {
      const list = JSON.parse(String(v)) as unknown;
      if (!Array.isArray(list) || !list.length) return nothing;
      return html`<span class="hdm-chips">${list.map((x) => chip(String(x)))}</span>`;
    } catch {
      return nothing;
    }
  }

  /**
   * The overview is a state machine. Empty stack = the hierarchy family tree;
   * otherwise the neighbourhood of the stack's last member. Clicking a type
   * with graph relationships pushes it; clicking a stack member truncates to
   * it; Escape pops. Types without relationships only ring (no state change).
   */
  readonly #stack = signal<readonly string[]>([]);
  /** A transient relationless selection: a ring, no state change. */
  readonly #ring = signal<string | undefined>(undefined);
  /** Windows leaving the scene (animation in flight), name → old position. */
  readonly #leaving = signal<ReadonlyMap<string, WinPos>>(new Map());
  /** Windows entering the scene (animation in flight). */
  readonly #entering = signal<ReadonlySet<string>>(new Set());
  /** The edge layer is fading (animation in flight). */
  readonly #linesFade = signal(false);
  #leavingTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /** Windows expanded to show their fields, by type name. */
  readonly #expanded = signal<ReadonlySet<string>>(new Set());

  #setWin(name: string, open: boolean): void {
    const next = new Set(this.#expanded.value);
    if (open) next.add(name);
    else next.delete(name);
    this.#expanded.value = next;
  }

  /**
   * Move to a new overview state. The old scene is laid out from the current
   * state, so leaving windows keep their old positions while the rest animate
   * to the fresh layout; a timer clears the flags once the transitions end.
   */
  #goto(next: readonly string[]): void {
    if (m === undefined) return;
    if (this.#leavingTimer !== undefined) {
      clearTimeout(this.#leavingTimer);
      this.#leavingTimer = undefined;
    }
    const cur = this.#stack.value;
    const expanded = this.#expanded.value;
    const oldLay = cur.length > 0 ? layoutHood(m, cur, expanded) : layoutForest(m);
    const newLay = next.length > 0 ? layoutHood(m, next, expanded) : layoutForest(m);
    const oldVisible = cur.length > 0 ? (oldLay as HdmHood).visible : new Set(oldLay.pos.keys());
    const newVisible = next.length > 0 ? (newLay as HdmHood).visible : new Set(newLay.pos.keys());
    const leaving = new Map<string, WinPos>();
    for (const n of oldVisible) if (!newVisible.has(n)) leaving.set(n, oldLay.pos.get(n)!);
    const entering = new Set<string>();
    for (const n of newVisible) if (!oldVisible.has(n)) entering.add(n);
    this.#stack.value = next;
    this.#ring.value = undefined;
    this.#leaving.value = leaving;
    this.#entering.value = entering;
    this.#linesFade.value = true;
    this.#leavingTimer = setTimeout(() => {
      this.#leaving.value = new Map();
      this.#entering.value = new Set();
      this.#linesFade.value = false;
      this.#leavingTimer = undefined;
    }, 260);
    // Recentre the wrap: the hub (or the tree's roots) lands viewport-centred.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const wrap = this.querySelector<HTMLElement>(".hdm-canvas-wrap");
        if (wrap === null) return;
        const maxX = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
        const maxY = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
        const hubLeft = next.length > 0 ? newLay.pos.get(next[next.length - 1]!)!.x : 0;
        wrap.scrollLeft = Math.min(Math.max(hubLeft - (wrap.clientWidth - WIN_W) / 2, 0), maxX);
        wrap.scrollTop = Math.min(Math.max(newLay.height / 2 - wrap.clientHeight / 2, 0), maxY);
      }),
    );
  }

  #clickWin(name: string): void {
    if (m === undefined) return;
    const stack = this.#stack.value;
    const i = stack.indexOf(name);
    if (i >= 0) {
      if (i === stack.length - 1) return; // the current hub: nothing to do
      this.#goto(stack.slice(0, i + 1));
      return;
    }
    if (!hasGraphRels(name, m)) this.#ring.value = this.#ring.value === name ? undefined : name;
    else this.#goto([...stack, name]);
  }

  #esc(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    if (this.#stack.value.length > 0) this.#goto(this.#stack.value.slice(0, -1));
    else if (this.#ring.value !== undefined) this.#ring.value = undefined;
  }

  #crumbs(): BreadcrumbItem[] {
    return [
      { id: "overview", label: "Overview", activate: () => this.#goto([]) },
      ...this.#stack.value.map((name) => ({
        id: name,
        label: name,
        activate: () => this.#goto(this.#stack.value.slice(0, this.#stack.value.indexOf(name) + 1)),
      })),
    ];
  }

  /** One field cell of the window's grid: the name, then icon columns (ref link, flags, many). */
  #fieldItem({ name: fname, def, from }: FieldRow): View {
    const inherited = from !== undefined ? ` · inherited from ${from}` : "";
    return html`<div class="hdm-field" role="listitem" title=${`${fname}${inherited}`}>
      <span class="hdm-field-name">${fname}</span>${this.#typeGlyph(def)}${this.#flagGlyphs(def)}${def.many === true
        ? glyph(icons.many, "many values")
        : nothing}
    </div>`;
  }

  #typeGlyph(def: FieldDef): View {
    if (def.ref !== undefined) {
      return html`<span class="hdm-glyph hdm-ref" role="link" tabindex="0" title=${`relationship to ${def.ref}`}
        aria-label=${`relationship to ${def.ref}`}
        @click=${(e: Event) => (e.stopPropagation(), this.#clickWin(def.ref!))}
        @keydown=${(e: KeyboardEvent) =>
          e.key === "Enter" || e.key === " " ? (e.preventDefault(), this.#clickWin(def.ref!)) : nothing}
        >${icons.links}</span>`;
    }
    if (def.computed !== undefined) return glyph(icons.typeText("ƒ"), "computed");
    const dt = def.type ?? "";
    const [icon, label] = TYPE_GLYPH[dt] ?? [icons.enum, `enum ${dt}`];
    return glyph(icon, label);
  }

  #flagGlyphs(def: FieldDef): View {
    const out = (["required", "unique", "owned"] as const).flatMap((k) => {
      if (def[k] !== true) return [];
      const entry = FLAG_GLYPH[k];
      return entry === undefined ? [] : [glyph(entry[0], entry[1])];
    });
    return out.length ? html`<span class="hdm-glyphs">${out}</span>` : nothing;
  }

  readonly #fieldRenderers: Readonly<Record<string, CellRenderer>> = {
    dataType: (entity) => {
      const refId = String(entity.refId ?? "");
      return refId ? refChip(refId, (n) => this.#openType(n)) : val(String(entity.dataType));
    },
    source: (entity) => {
      const s = String(entity.source ?? "");
      return s ? quiet(s) : nothing;
    },
    flags: (entity) => this.#jsonChips(entity.flags),
    rule: (entity) => {
      const lang = String(entity.language ?? "");
      if (lang) return quiet(`computed · ${lang}`);
      let parsed: { when?: Criterion; default?: Value } | undefined;
      try {
        parsed = JSON.parse(String(entity.rule ?? "")) as { when?: Criterion; default?: Value };
      } catch {
        parsed = undefined;
      }
      if (parsed === undefined || (parsed.when === undefined && parsed.default === undefined)) return nothing;
      return html`<div class="hdm-rule">
        ${parsed.when !== undefined
          ? html`<div class="hdm-rule-line"><span class="hdm-quiet">when</span>${sent(parsed.when, { root: String(entity.typeName), go: (n) => this.#goCrit(n) })}</div>`
          : nothing}
        ${parsed.default !== undefined
          ? html`<div class="hdm-rule-line"><span class="hdm-quiet">default</span>${valueView(parsed.default)}</div>`
          : nothing}
      </div>`;
    },
  };

  #fieldControls = (row: RowState): RowControl[] => {
    if (String(row.entity.formula ?? "") === "") return [];
    const grid = () => this.#fieldsGrid();
    return row.expanded
      ? [{ label: "Close", icon: icons.cancel, run: () => void grid()?.collapse(row.key) }]
      : [{ label: "Show formula", icon: icons.view, run: () => void grid()?.expand(row.key) }];
  };

  #fieldsExpansion: Expansion = {
    noun: "formula",
    canExpand: (entity: Entity) => String(entity.formula ?? "") !== "",
    content: (row: RowState): ExpansionEditor => ({
      get view() {
        return html`<div class="hdm-formula-view">
          <span class="hdm-quiet">computed in ${String(row.entity.language ?? "sql")}</span>
          <pre class="hdm-formula">${String(row.entity.formula ?? "")}</pre>
        </div>`;
      },
    }),
  };

  /** The edge layer: tree elbows in the hierarchy, routed solid + dashed edges in a neighbourhood. */
  #lines(lay: HdmLayout | HdmHood, hood: boolean): View {
    const expanded = this.#expanded.value;
    const paths: View[] = [];
    if (hood) {
      for (const r of (lay as HdmHood).routes) {
        paths.push(svg`<path class=${r.kind === "solid" ? "hdm-line" : "hdm-line hdm-rel"} d=${`M ${r.pts.join(" ")}`}></path>`);
        if (r.label !== undefined) paths.push(svg`<text class="hdm-edge-label" x=${r.lx} y=${r.ly}>${r.label}</text>`);
      }
    } else {
      for (const { from, to } of (lay as HdmLayout).edges) {
        const a = lay.pos.get(from)!;
        const b = lay.pos.get(to)!;
        const px = a.x + WIN_W / 2;
        const cx = b.x + WIN_W / 2;
        const my = (a.y + winH(expanded, from) + b.y) / 2;
        paths.push(svg`<path class="hdm-line" d=${`M ${px} ${a.y + winH(expanded, from)} V ${my} H ${cx} V ${b.y}`}></path>`);
      }
    }
    return svg`<svg class="hdm-lines" width=${lay.width} height=${lay.height} aria-hidden="true"
      data-fade=${this.#linesFade.value ? "" : nothing}>${paths}</svg>`;
  }

  /**
   * One window on the overview canvas. aster-window itself is an overlay
   * window manager (popover, drag, resize, close), not a diagram node, so
   * these are aster-section panels in its visual language: a shared title
   * bar with the type name and field count, then its fields as a grid.
   * Placement and the selection ring stay host CSS and data attributes.
   */
  #win(
    name: string,
    t: TypeDef,
    p: WinPos,
    sel: boolean,
    ringed: boolean,
    entering: boolean,
    leaving: boolean,
  ): View {
    const open = this.#expanded.value.has(name);
    const count = declaredFields(t, m!).length + computedFields(t, m!).length;
    const meta = [
      ...(t.inherits !== undefined ? [`extends ${t.inherits}`] : []),
      ...(t.behaviours ?? []).map((b) => `behaviour ${b}`),
      ...(t.mixins ?? []).map((x) => `mixin ${x}`),
    ].join(" · ");
    return html`<aster-section class="hdm-win" style=${`left:${p.x}px;top:${p.y}px`}
      data-sel=${sel ? "" : nothing} data-ring=${ringed ? "" : nothing}
      data-entering=${entering ? "" : nothing} data-leaving=${leaving ? "" : nothing}
      .heading=${name} .open=${open} .summary=${count} .chrome=${WIN_CHROME}
      .body=${open
        ? html`<div class="hdm-win-body">
            <div class="hdm-win-meta">${meta}</div>
            <div class="hdm-fields" role="list">
              ${[...declaredFields(t, m!), ...computedFields(t, m!)].map((f) => this.#fieldItem(f))}
            </div>
          </div>`
        : nothing}
      @section-toggle=${(e: CustomEvent<{ open: boolean; reason: "user" | "error" }>) => {
        e.stopPropagation();
        this.#setWin(name, e.detail.open);
      }}
      @click=${() => this.#clickWin(name)}></aster-section>`;
  }

  #overviewPane(): View {
    if (!m) return quiet("No model.");
    const stack = this.#stack.value;
    const hood = stack.length > 0;
    const lay = hood ? layoutHood(m, stack, this.#expanded.value) : layoutForest(m);
    const leaving = this.#leaving.value;
    const entering = this.#entering.value;
    const ring = this.#ring.value;
    const selected = new Set(stack);
    const names = [...new Set([...lay.pos.keys(), ...leaving.keys()])];
    return html`<div class="hdm-canvas-wrap" @keydown=${(e: KeyboardEvent) => this.#esc(e)}>
      <div class="hdm-canvas-tools">
        ${hood ? html`<aster-breadcrumbs .items=${this.#crumbs()}></aster-breadcrumbs>` : nothing}
        <p class="hdm-note">${hood
          ? "Dashed edges are relationships, solid edges inheritance. Select more types to widen the neighbourhood; a breadcrumb or Escape steps back."
          : "Each window is a type in the family tree — children inherit their parent's fields. Click a type with relationships to see its neighbourhood; open a window's fields with the chevron."}</p>
      </div>
      <div class="hdm-canvas" style=${`width:${lay.width}px;height:${lay.height}px`}
        @click=${(e: Event) =>
          e.target === e.currentTarget && ring !== undefined ? (this.#ring.value = undefined) : nothing}>
        ${this.#lines(lay, hood)}
        ${repeat(
          names,
          (name) => name,
          (name) => {
            const def = m.types[name];
            const p = leaving.get(name) ?? lay.pos.get(name);
            if (def === undefined || p === undefined) return nothing;
            return this.#win(name, def, p, selected.has(name), ring === name, entering.has(name), leaving.has(name));
          },
        )}
      </div>
    </div>`;
  }

  #typesPane(): View {
    if (!m) return quiet("No model.");
    const t = m.types[this.#type.value];
    return html`<div class="hdm-types">
      <ul class="hdm-types-list" role="list">
        ${typeOrder(m).map(({ name, depth }) => {
          const def = m.types[name];
          if (def === undefined) return nothing;
          const meta = [
            def.inherits !== undefined ? `extends ${def.inherits}` : undefined,
            ...(def.mixins ?? []).map((x) => `+ ${x}`),
            ...(def.behaviours ?? []),
          ].filter((x): x is string => x !== undefined);
          const n = declaredFields(def, m).length + computedFields(def, m).length;
          const label = `${name}${meta.length ? ` · ${meta.join(" · ")}` : ""} · ${n} fields`;
          return html`<li><button type="button" class="hdm-type" style=${`--depth: ${depth}`} aria-current=${this.#type.value === name ? "true" : "false"}
            aria-label=${label} @click=${() => (this.#type.value = name)}>
            <strong>${name}</strong>${meta.length ? html`<span class="hdm-type-meta">${meta.join(" · ")}</span>` : nothing}
            <span class="hdm-type-count">${n} fields</span></button></li>`;
        })}
      </ul>
      ${t === undefined
        ? nothing
        : html`<section class="hdm-detail">
            <header class="hdm-detail-head"><h2>${this.#type.value}</h2>
              ${t.id !== undefined ? chip(`id: ${t.id}`) : nothing}
              ${t.inherits !== undefined ? chip(`inherits ${t.inherits}`) : nothing}
              ${(t.mixins ?? []).map((x) => chip(`mixin ${x}`))}
              ${(t.behaviours ?? []).map((x) => chip(`behaviour ${x}`))}
              ${t.readOnly === true ? html`<span class="hdm-chip hdm-lock">read-only</span>` : nothing}</header>
            ${this.#ctx.value === undefined
              ? quiet("Loading…")
              : html`<aster-grid class="hdm-fields-grid" ${ref(this.#onFieldsGrid)} .ctx=${this.#ctx.value} .set=${"Fields"}
                  .view=${HDM_FIELDS_VIEW} .label=${`Fields of ${this.#type.value}`} .editable=${false}
                  .empty=${"No fields."} .base=${{ op: "eq", field: "typeId", value: this.#type.value }}
                  .renderers=${this.#fieldRenderers} .rowControls=${this.#fieldControls}
                  .expansion=${this.#fieldsExpansion}></aster-grid>`}
            ${t.transitions !== undefined && t.transitions.length ? html`<h3>State machine</h3>${this.#transitionsView(t)}` : nothing}
          </section>`}
    </div>`;
  }

  #transitionsView(t: TypeDef): View {
    return html`${(t.transitions ?? []).map(
      (machine) => html`<section class="hdm-machine">
        <span class="hdm-quiet">${machine.field}</span>
        ${machine.actions.map(
          (a) => html`<div class="hdm-trans">
            <div class="hdm-trans-main"><span class="hdm-chip hdm-action">${a.action}</span>
              <span class="hdm-from">${a.from.join(" · ")}</span><span class="hdm-arrow">→</span><span class="hdm-to">${a.to}</span></div>
            ${a.requires !== undefined
              ? html`<div class="hdm-trans-line"><span class="hdm-quiet">requires</span>${sent(a.requires, { root: this.#type.value, go: (n) => this.#goCrit(n) })}</div>`
              : nothing}
            ${a.set !== undefined
              ? html`<div class="hdm-trans-line"><span class="hdm-quiet">sets</span>
                  ${Object.entries(a.set).map(([f, v]) => html`<span class="hdm-set">${fld(f)}${valueView(v)}</span>`)}</div>`
              : nothing}
          </div>`,
        )}
      </section>`,
    )}`;
  }

  #criteriaPane(): View {
    if (!m) return quiet("No model.");
    const roots = criterionRoots();
    return html`<p class="hdm-note">Predicates shared by rules, gates and security rows, each shown as a sentence with the record
      type it reads — "its" is that record, and a hop names the record it lands on.</p>
      <section class="hdm-cards">
        ${Object.entries(m.criteria).map(([name, c]) => {
          const rs = [...(roots.get(name) ?? [])].sort();
          return html`<section class="hdm-card" id=${`crit-${name}`} data-focus=${this.#crit.value === name ? "true" : "false"}>
            <h3>${name}</h3>
            <div class="hdm-card-sub">${rs.length
              ? html`<span class="hdm-quiet">reads</span>${rs.map((r) => chip(r))}`
              : quiet("not referenced yet")}</div>
            ${sent(c, { root: rs[0] ?? "?", go: (n) => this.#goCrit(n) })}
          </section>`;
        })}
      </section>`;
  }

  #securityPane(): View {
    if (!m) return quiet("No model.");
    const roles = m.security.roles;
    return html`<p class="hdm-note">Closed by default: a type with no row for a role is denied. Row criteria generate RLS
      policies and read as the actor — a contact sees a ticket when the requester is them, an agent when it is
      assigned to them, in their team, or unassigned.</p>
      <table class="hdm-table hdm-security">
        <thead><tr><th>Type</th>${roles.map((r) => html`<th>${r}</th>`)}</tr></thead>
        <tbody>${typeOrder(m).map(({ name: type }) => {
          const byRole = m.security.rows?.[type];
          return html`<tr><th>${type}</th>
            ${roles.map((r) => {
              const c = byRole?.[r];
              return html`<td>${c === undefined
                ? html`<span class="hdm-denied">denied</span>`
                : typeof c === "boolean"
                  ? chip(c ? "every record" : "none")
                  : sent(c, { root: type, go: (n) => this.#goCrit(n) })}</td>`;
            })}</tr>`;
        })}</tbody>
      </table>`;
  }

  #reactionsPane(): View {
    if (!m) return quiet("No model.");
    if (!m.reactions.length) return quiet("No reactions in the day-one model.");
    return html`<p class="hdm-note">Outbox reactions run after commit; their writes pass the same sync checks as any write.</p>
      <section class="hdm-cards">${m.reactions.map(
        (r) => html`<section class="hdm-card hdm-reaction"><h3>${r.name}</h3>
          <div class="hdm-trans-main"><span class="hdm-quiet">on</span>${val(r.on)}</div>
          <div class="hdm-trans-line"><span class="hdm-quiet">when</span>${sent(r.guard, { root: r.on.split(".")[0]!, go: (n) => this.#goCrit(n) })}</div>
          <div class="hdm-trans-line"><span class="hdm-quiet">then</span><span class="hdm-chip hdm-action">${r.action}</span></div>
        </section>`,
      )}</section>`;
  }

  #enumsPane(): View {
    if (!m) return quiet("No model.");
    return html`<h3>Enums</h3>
      <p class="hdm-note">Model-authored fixed sets: changed by model change, not by data.</p>
      <section class="hdm-cards">${Object.entries(m.enums).map(
        ([name, values]) => html`<section class="hdm-card"><h3>${name}</h3>
          <div class="hdm-chips">${values.map((v) => chip(v))}</div></section>`,
      )}</section>
      <h3>Custom types</h3>
      <p class="hdm-note">Named value domains: the type is the schema plus its rules; the backing is a separate axis.</p>
      <section class="hdm-cards">${Object.entries(m.customTypes).map(
        ([name, ct]) => html`<section class="hdm-card"><h3>${name}</h3>
          <div class="hdm-trans-main">${chip(`base: ${ct.base}`)}
            ${ct.pattern !== undefined ? html`<span class="hdm-quiet">matches</span><code class="hdm-val">${ct.pattern}</code>` : nothing}
            ${ct.validate !== undefined ? chip(`validate: ${ct.validate}`) : nothing}</div></section>`,
      )}</section>
      <h3>Mixins</h3>
      <p class="hdm-note">Structural mixins: user-declared bundles of fields a type includes.</p>
      <section class="hdm-cards">${Object.entries(m.mixins).map(
        ([name, mix]) => html`<section class="hdm-card"><h3>${name}</h3>
          <div class="hdm-chips">${Object.keys(mix.fields ?? {}).map((f) => chip(f))}</div></section>`,
      )}</section>`;
  }

  protected render(): View {
    const view = this.#view.value;
    return html`<div class="head"><h1>Helpdesk model</h1>
        <span class="hdm-sub">${m ? `${m.name} v${m.version} · model ${m.id} · spike render (read-only)` : "no model"}</span></div>
      <aster-tabs class="hdm-views" .label=${"Helpdesk model views"} .controls=${"hdm-view"}
        .items=${TABS.map((t) => ({ value: t.value, label: t.label }))}
        .value=${view} @change=${(e: CustomEvent<HdmView>) => (this.#view.value = e.detail)}></aster-tabs>
      <div id="hdm-view" role="tabpanel" class="hdm-view">
        ${view === "overview" ? this.#overviewPane()
          : view === "types" ? this.#typesPane()
          : view === "criteria" ? this.#criteriaPane()
          : view === "security" ? this.#securityPane()
          : view === "reactions" ? this.#reactionsPane()
          : this.#enumsPane()}
      </div>`;
  }
}

const FLAGS: readonly (readonly [keyof FieldDef, string])[] = [
  ["many", "many"],
  ["owned", "owned"],
  ["required", "required"],
  ["unique", "unique"],
];

define("aster-helpdesk-page", HelpdeskPage);
