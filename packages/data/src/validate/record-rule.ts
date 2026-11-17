import { compareCodePoints, ordering } from "../criteria/values.ts";
import type { EdmType, Entity, EntityType, Field, RecordRule, RuleOutcome, RuleState, Value } from "../schema/model.ts";

export type { RecordRule, RuleOutcome, RuleState } from "../schema/model.ts";

/*
 * A published `Validation.Constraint` on an entity type, evaluated over a
 * record and its working owned rows.
 *
 * Invariants:
 * - Only what the client can judge exactly is judged. Anything else is
 *   `UNKNOWN`, and three-valued logic carries it: `false and UNKNOWN` is
 *   false, `true or UNKNOWN` is true, anything else involving it is UNKNOWN,
 *   and an UNKNOWN condition is `deferred` to the server.
 * - Numbers are exact rationals; a value that has no finite decimal form
 *   (an average of three) is not compared, because the server rounds it.
 * - Semantics follow the engine: `eq` and `ne` are null-aware, an ordering
 *   comparison with null is false, arithmetic with null is null, aggregates
 *   skip nulls and are null over no rows, and a condition that is not true
 *   fails the record.
 */

const UNKNOWN: unique symbol = Symbol("unknown");
interface Num { readonly k: "n"; readonly n: bigint; readonly d: bigint }
interface Str { readonly k: "s"; readonly s: string; readonly field?: Field }
type Val = typeof UNKNOWN | null | boolean | Num | Str;

interface Cx {
  readonly record: Entity;
  readonly rows: Readonly<Record<string, readonly Entity[]>>;
  /** The related row, inside an aggregate's filter. */
  readonly row?: Entity;
}
type Node = (cx: Cx) => Val;

const NUMERIC: ReadonlySet<EdmType> = new Set(["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32", "Edm.Int64", "Edm.Single", "Edm.Double", "Edm.Decimal"]);
const AGGREGATES: ReadonlySet<string> = new Set(["Sum", "Min", "Max", "Average", "Count"]);
const RE_NUM = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

// ---- exact numbers ----

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function num(n: bigint, d = 1n): Num {
  const g = gcd(n, d) || 1n;
  const sign = d < 0n ? -1n : 1n;
  return { k: "n", n: (sign * n) / g, d: (sign * d) / g };
}

function parseNum(v: string | number): Num | undefined {
  const m = RE_NUM.exec(String(v));
  if (!m || ((m[2] ?? "") === "" && (m[3] ?? "") === "")) return undefined;
  const frac = m[3] ?? "";
  const exp = Number(m[4] ?? 0) - frac.length;
  if (Math.abs(exp) > 400) return undefined;
  const mantissa = BigInt(`${m[2] || "0"}${frac}`) * (m[1] === "-" ? -1n : 1n);
  return exp >= 0 ? num(mantissa * 10n ** BigInt(exp)) : num(mantissa, 10n ** BigInt(-exp));
}

/** Whether the value has a finite decimal form, as the server's decimals do. */
function terminating(x: Num): boolean {
  let d = x.d;
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
}

function toVal(value: Value | undefined, field: Field | undefined): Val {
  if (value === null || value === undefined) return null;
  if (!field) return UNKNOWN;
  if (NUMERIC.has(field.type)) return (typeof value === "number" || typeof value === "string" ? parseNum(value) : undefined) ?? UNKNOWN;
  if (field.type === "Edm.Boolean") return typeof value === "boolean" ? value : UNKNOWN;
  if (field.type === "Edm.Binary") return UNKNOWN;
  return typeof value === "string" ? { k: "s", s: value, field } : UNKNOWN;
}

/** Orders two non-null values; UNKNOWN when they can't be compared exactly. */
function compare(a: Val, b: Val): number | typeof UNKNOWN {
  if (a === null || b === null || a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
  if (typeof a === "boolean" || typeof b === "boolean") return typeof a === "boolean" && typeof b === "boolean" ? Number(a) - Number(b) : UNKNOWN;
  if (a.k === "s" && b.k === "n") {
    const c = compare(b, a);
    return c === UNKNOWN ? c : -c;
  }
  let result: number | typeof UNKNOWN;
  if (a.k === "n") {
    // A string that isn't one of the record's own text values is a literal: read as the number it is compared with.
    const other = b.k === "n" ? b : b.field === undefined ? parseNum(b.s) : undefined;
    if (!other || !terminating(a) || !terminating(other)) return UNKNOWN;
    const x = a.n * other.d;
    const y = other.n * a.d;
    result = x < y ? -1 : x > y ? 1 : 0;
  } else {
    if (b.k !== "s") return UNKNOWN;
    const field = a.field ?? b.field;
    if (field && field.type !== "Edm.String") {
      try {
        result = ordering(a.s, b.s, field) ?? UNKNOWN;
      } catch {
        return UNKNOWN;
      }
    } else {
      result = compareCodePoints(a.s, b.s);
    }
  }
  return result;
}

// ---- three-valued logic ----

type Truth = boolean | null | typeof UNKNOWN;

function truth(v: Val): Truth {
  return typeof v === "boolean" || v === null || v === UNKNOWN ? v : UNKNOWN;
}

function and(values: readonly Truth[]): Truth {
  if (values.includes(false)) return false;
  if (values.includes(UNKNOWN)) return UNKNOWN;
  return values.includes(null) ? null : true;
}

function or(values: readonly Truth[]): Truth {
  if (values.includes(true)) return true;
  if (values.includes(UNKNOWN)) return UNKNOWN;
  return values.includes(null) ? null : false;
}

function equals(a: Val, b: Val): Truth {
  if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
  if (a === null || b === null) return a === b;
  const c = compare(a, b);
  return c === UNKNOWN ? UNKNOWN : c === 0;
}

const ORDER: Readonly<Record<string, (c: number) => boolean>> = {
  $Gt: (c) => c > 0,
  $Ge: (c) => c >= 0,
  $Lt: (c) => c < 0,
  $Le: (c) => c <= 0,
};

function ordered(test: (c: number) => boolean, a: Val, b: Val): Truth {
  if (a === null || b === null) return false;
  const c = compare(a, b);
  return c === UNKNOWN ? UNKNOWN : test(c);
}

function arithmetic(op: string, a: Val, b: Val): Val {
  if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
  if (a === null || b === null) return null;
  const x = typeof a === "object" && a.k === "n" ? a : undefined;
  const y = typeof b === "object" && b.k === "n" ? b : undefined;
  if (!x || !y) return UNKNOWN;
  switch (op) {
    case "$Add": return num(x.n * y.d + y.n * x.d, x.d * y.d);
    case "$Sub": return num(x.n * y.d - y.n * x.d, x.d * y.d);
    default: return num(x.n * y.n, x.d * y.d);
  }
}

// ---- compiling the published expression ----

const unknownNode: Node = () => UNKNOWN;

interface Scope {
  readonly type: EntityType;
  /** Inside an aggregate's filter, where paths start at the related row. */
  readonly row: boolean;
}

class Compiler {
  readonly reads = new Set<string>();
  partial = false;
  constructor(
    readonly type: EntityType,
    readonly typeOf: (set: string) => EntityType | undefined,
    readonly isAster: (functionName: string) => string | undefined,
  ) {}

  /** What the client can't judge: UNKNOWN, noting which navigations it reads. */
  #unsupported(expr: unknown, scope: Scope): Node {
    this.partial = true;
    if (!scope.row) this.#collect(expr);
    return unknownNode;
  }

  #collect(v: unknown): void {
    if (Array.isArray(v)) return void v.forEach((x) => this.#collect(x));
    if (typeof v !== "object" || v === null) return;
    const o = v as Record<string, unknown>;
    const fn = typeof o["$Function"] === "string" ? o["$Function"] : "";
    const quantifier = /\.(Any|All)$/.test(fn);
    for (const key of ["$Path", "$NavigationPropertyPath"]) {
      const path = o[key];
      const head = typeof path === "string" ? path.split("/")[0] : undefined;
      if (head !== undefined && (key === "$NavigationPropertyPath" || path !== head) && this.type.navigation(head)) this.reads.add(head);
    }
    if (quantifier && Array.isArray(o["$Apply"])) return this.#collect(o["$Apply"][0]);
    for (const child of Object.values(o)) this.#collect(child);
  }

  compile(expr: unknown, scope: Scope): Node {
    if (expr === null) return () => null;
    if (typeof expr === "boolean") return () => expr;
    if (typeof expr === "number") {
      const n = parseNum(expr);
      return n ? () => n : this.#unsupported(expr, scope);
    }
    if (typeof expr === "string") return () => ({ k: "s", s: expr });
    if (typeof expr !== "object" || Array.isArray(expr)) return this.#unsupported(expr, scope);
    const o = expr as Record<string, unknown>;
    if (typeof o["$Path"] === "string") return this.#path(o["$Path"], expr, scope);
    if ("$Not" in o) {
      const inner = this.compile(o["$Not"], scope);
      return (cx) => {
        const t = truth(inner(cx));
        return t === UNKNOWN || t === null ? t : !t;
      };
    }
    if ("$Apply" in o) return this.#apply(o, scope);
    for (const op of ["$And", "$Or", "$Eq", "$Ne", "$Gt", "$Ge", "$Lt", "$Le", "$Add", "$Sub", "$Mul"]) {
      const operands = o[op];
      if (operands === undefined) continue;
      if (!Array.isArray(operands) || operands.length !== 2) return this.#unsupported(expr, scope);
      const [l, r] = operands.map((x) => this.compile(x, scope)) as [Node, Node];
      switch (op) {
        case "$And": return (cx) => and([truth(l(cx)), truth(r(cx))]);
        case "$Or": return (cx) => or([truth(l(cx)), truth(r(cx))]);
        case "$Eq": return (cx) => equals(l(cx), r(cx));
        case "$Ne": return (cx) => {
          const t = equals(l(cx), r(cx));
          return t === UNKNOWN ? t : !t;
        };
        case "$Add":
        case "$Sub":
        case "$Mul": return (cx) => arithmetic(op, l(cx), r(cx));
        default: {
          const test = ORDER[op]!;
          return (cx) => ordered(test, l(cx), r(cx));
        }
      }
    }
    return this.#unsupported(expr, scope);
  }

  #path(path: string, expr: unknown, scope: Scope): Node {
    const segments = path.split("/");
    const [head, tail] = segments;
    if (segments.length === 1) {
      const field = scope.type.field(path);
      if (!field) return this.#unsupported(expr, scope);
      return scope.row ? (cx) => toVal(cx.row?.[path], field) : (cx) => toVal(cx.record[path], field);
    }
    const nav = scope.row ? undefined : this.#owned(head!);
    if (nav && segments.length === 2 && tail === "$count") {
      this.reads.add(nav);
      return (cx) => {
        const rows = cx.rows[nav];
        return rows ? num(BigInt(rows.length)) : UNKNOWN;
      };
    }
    return this.#unsupported(expr, scope);
  }

  #owned(name: string): string | undefined {
    const nav = this.type.navigation(name);
    return nav?.owned && nav.collection ? nav.name : undefined;
  }

  #apply(o: Record<string, unknown>, scope: Scope): Node {
    const fn = typeof o["$Function"] === "string" ? this.isAster(o["$Function"]) : undefined;
    const args = o["$Apply"];
    if (scope.row || fn === undefined || !AGGREGATES.has(fn) || !Array.isArray(args)) return this.#unsupported(o, scope);
    const first = args[0] as Record<string, unknown> | undefined;
    const navName = typeof first?.["$NavigationPropertyPath"] === "string" ? this.#owned(first["$NavigationPropertyPath"]) : undefined;
    const nav = navName === undefined ? undefined : this.type.navigation(navName);
    const target = nav && this.typeOf(nav.target);
    if (!nav || !target) return this.#unsupported(o, scope);
    const rest = args.slice(1);
    const named = (rest[0] as Record<string, unknown> | undefined)?.["$PropertyPath"];
    const fieldName = typeof named === "string" ? named : undefined;
    const filterExpr = fieldName === undefined ? rest[0] : rest[1];
    const field = fieldName === undefined ? undefined : target.field(fieldName);
    const extra = fieldName === undefined ? rest.length > 1 : rest.length > 2;
    const needsNumber = fn === "Sum" || fn === "Average";
    if (extra || (fieldName === undefined && fn !== "Count") || (fieldName !== undefined && !field)
      || (needsNumber && !NUMERIC.has(field!.type)) || (fn !== "Count" && field!.type === "Edm.Binary")) {
      return this.#unsupported(o, scope);
    }
    this.reads.add(nav.name);
    const filter = filterExpr === undefined ? undefined : this.compile(filterExpr, { type: target, row: true });
    const name = nav.name;
    return (cx) => {
      const all = cx.rows[name];
      if (!all) return UNKNOWN;
      let rows = all;
      if (filter) {
        const kept: Entity[] = [];
        for (const row of all) {
          const keep = filter({ record: cx.record, rows: cx.rows, row });
          if (keep === UNKNOWN) return UNKNOWN;
          if (keep === true) kept.push(row);
        }
        rows = kept;
      }
      if (fn === "Count" && !field) return num(BigInt(rows.length));
      const values: (Num | Str | boolean)[] = [];
      for (const row of rows) {
        const v = toVal(row[fieldName!], field);
        if (v === UNKNOWN) return UNKNOWN;
        if (v !== null) values.push(v);
      }
      if (fn === "Count") return num(BigInt(values.length));
      if (values.length === 0) return null;
      if (fn === "Sum" || fn === "Average") {
        let total = num(0n);
        for (const v of values) total = arithmetic("$Add", total, v) as Num;
        return fn === "Sum" ? total : num(total.n, total.d * BigInt(values.length));
      }
      let best = values[0]!;
      for (const v of values.slice(1)) {
        const c = compare(v, best);
        if (c === UNKNOWN) return UNKNOWN;
        if (fn === "Min" ? c < 0 : c > 0) best = v;
      }
      return best;
    };
  }
}

class ConstraintRule implements RecordRule {
  readonly id: string;
  readonly message: string;
  readonly #build: () => { readonly compiler: Compiler; readonly node: Node };
  #built: { readonly compiler: Compiler; readonly node: Node } | undefined;

  constructor(id: string, message: string, build: () => { compiler: Compiler; node: Node }) {
    this.id = id;
    this.message = message;
    this.#build = build;
  }

  /** Compiled on first use: the schema is complete by then. */
  #get() {
    return (this.#built ??= this.#build());
  }

  get evaluable(): boolean {
    return !this.#get().compiler.partial;
  }

  get reads(): readonly string[] {
    return [...this.#get().compiler.reads];
  }

  get list(): string | undefined {
    const { reads, type } = this.#get().compiler;
    const [only] = reads;
    return reads.size === 1 && only !== undefined && type.navigation(only)?.owned ? only : undefined;
  }

  evaluate(state: RuleState): RuleOutcome {
    const result = this.#get().node({ record: state.record, rows: state.rows });
    if (result === UNKNOWN || (typeof result === "object" && result !== null)) return "deferred";
    return result === true ? "pass" : "fail";
  }
}

const TERM = /^(?:Validation|Org\.OData\.Validation\.V1)\.Constraint#(.+)$/;

/**
 * The entity-level `Validation.Constraint#id` annotations of a type as rules.
 * `typeOf` resolves an entity set's type lazily (the schema isn't complete
 * while its types are read); `resolve` maps a namespace to its alias here.
 */
export function readRecordRules(
  type: EntityType,
  annotations: Readonly<Record<string, unknown>>,
  typeOf: (set: string) => EntityType | undefined,
  resolve: (namespace: string) => string,
): readonly RecordRule[] {
  const aster = new Set([resolve("Aster.Data.V1"), "Aster.Data.V1", "AsterData"]);
  const isAster = (name: string): string | undefined => {
    const dot = name.lastIndexOf(".");
    return dot > 0 && aster.has(name.slice(0, dot)) ? name.slice(dot + 1) : undefined;
  };
  const rules: RecordRule[] = [];
  for (const [key, value] of Object.entries(annotations)) {
    const id = TERM.exec(key)?.[1];
    if (id === undefined || typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (!("Condition" in record)) continue;
    const message = typeof record["FailureMessage"] === "string" ? record["FailureMessage"] : "This record doesn’t satisfy its rule.";
    rules.push(new ConstraintRule(id, message, () => {
      const compiler = new Compiler(type, typeOf, isAster);
      return { compiler, node: compiler.compile(record["Condition"], { type, row: false }) };
    }));
  }
  return rules;
}
