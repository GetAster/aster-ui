import { batch, computed, signal, type ReadonlySignal } from "@preact/signals-core";
import type { Criteria, RelativeDate } from "./ast.ts";
import { toFilter } from "./compile.ts";
import { relatedOf, resolveRelative } from "./relative.ts";
import type { EntityType, Field, Schema, Value } from "../schema/model.ts";

/** An editable boolean group. A synthetic root does not add a redundant AND. */
export interface FilterGroup { readonly kind: "group"; readonly id: string; readonly op: string; readonly children: readonly FilterNode[]; readonly synthetic?: boolean }
/** A typed comparison; text remains unparsed while a person edits. */
export interface FilterCondition { readonly kind: "condition"; readonly id: string; readonly field: string; readonly op: string; readonly mode: "value" | "field" | "relative"; readonly text: string; readonly other: string; readonly caseInsensitive: boolean }
/** A related-record condition scoped to a navigation's entity type. */
export interface FilterRelated { readonly kind: "related"; readonly id: string; readonly field: string; readonly op: string; readonly children: readonly FilterNode[] }
export type FilterNode = FilterGroup | FilterCondition | FilterRelated;
export interface FilterProblem { readonly id: string; readonly message: string }
export interface FilterResult { readonly valid: boolean; readonly criteria: Criteria | undefined; readonly problems: readonly FilterProblem[] }
export interface FilterChange { readonly field?: string; readonly op?: string; readonly mode?: FilterCondition["mode"]; readonly text?: string; readonly other?: string; readonly caseInsensitive?: boolean }

/** Typed operators offered by both metadata-driven query controls and filter drafts. */
export function filterOperators(field: Field | undefined): readonly string[] {
  if (!field || field.type === "Edm.Binary") return [];
  const equality = ["eq", "ne", "in", "isnull", "notnull"];
  if (field.allowedValues) return equality;
  switch (field.type) {
    case "Edm.Boolean": case "Edm.Guid": return equality;
    case "Edm.String": return [...equality, "contains", "startswith", "endswith"];
    default: return [...equality, "gt", "ge", "lt", "le"];
  }
}

/** A query draft independent of database clause records. Only apply changes its committed criteria. */
export class FilterDraft {
  readonly schema: Schema;
  readonly set: string;
  readonly #root = signal<FilterGroup>({ kind: "group", id: "", op: "and", children: [], synthetic: true });
  readonly #applied = signal<Criteria | undefined>(undefined);
  readonly #baseline = signal("");
  #sequence = 0;
  readonly root: ReadonlySignal<FilterGroup> = this.#root;
  readonly applied: ReadonlySignal<Criteria | undefined> = this.#applied;
  readonly dirty = computed(() => JSON.stringify(this.#root.value) !== this.#baseline.value);
  readonly result: ReadonlySignal<FilterResult>;

  constructor(schema: Schema, set: string, criteria?: Criteria) {
    this.schema = schema;
    this.set = set;
    schema.set(set);
    this.result = computed(() => {
      const problems: FilterProblem[] = [];
      const root = this.#root.value;
      const criteria = root.children.length === 0 && root.synthetic ? undefined : this.#compile(root, schema.set(set).type, problems);
      if (criteria && !problems.length) {
        try { toFilter(resolveRelative(criteria, schema.set(set).type, Date.now(), relatedOf(schema, schema.set(set).type)), schema.set(set).type, schema.set(set), schema); }
        catch (error) { problems.push({ id: root.id, message: error instanceof Error ? error.message : String(error) }); }
      }
      return { valid: problems.length === 0, criteria: problems.length ? undefined : criteria, problems };
    });
    this.reset(criteria);
  }

  /** Replaces the applied value and draft together; no query or record write is performed. */
  reset(criteria?: Criteria): void {
    const snapshot = criteria === undefined ? undefined : structuredClone(criteria);
    const parsed = snapshot ? this.#from(snapshot) : undefined;
    const root: FilterGroup = parsed?.kind === "group" ? parsed : { kind: "group", id: this.#id(), op: "and", synthetic: true, children: parsed ? [parsed] : [] };
    batch(() => { this.#applied.value = snapshot; this.#root.value = root; this.#baseline.value = JSON.stringify(root); });
  }

  /** Discards draft edits and restores the applied expression. */
  cancel(): void { this.reset(this.#applied.peek()); }
  /** Clears only the draft. Call apply to commit the cleared expression. */
  clear(): void { this.#root.value = { kind: "group", id: this.#id(), op: "and", children: [], synthetic: true }; }
  /** Commits a complete valid draft atomically; returns false for any invalid clause. */
  apply(): boolean {
    const result = this.result.peek();
    if (!result.valid) return false;
    batch(() => { this.#applied.value = result.criteria; this.#baseline.value = JSON.stringify(this.#root.peek()); });
    return true;
  }

  /** Changes a clause without dropping incompatible values or unsupported fields. */
  change(id: string, change: FilterChange): void {
    const scope = this.typeFor(id);
    this.#map(id, (node) => {
      switch (node.kind) {
        case "condition": {
          let next = { ...node, ...change };
          if (change.op !== undefined && change.op !== node.op) {
            if (["in", "isnull", "notnull", "contains", "startswith", "endswith"].includes(change.op)) next = { ...next, mode: "value" };
            const field = scope?.field(node.field);
            if (change.op === "in" && node.mode === "value" && field) {
              let value: Value = node.text;
              try { value = literal(node.text, field); } catch { /* Keep invalid input available for repair. */ }
              next = { ...next, text: JSON.stringify(node.text === "" ? [] : [value]) };
            } else if (node.op === "in") {
              try {
                const values: unknown = JSON.parse(node.text);
                if (Array.isArray(values) && values.length === 1 && values[0] !== null) next = { ...next, text: String(values[0]) };
              } catch { /* Keep invalid input available for repair. */ }
            }
          }
          return next;
        }
        case "related": return { ...node, ...(change.field === undefined ? {} : { field: change.field }), ...(change.op === undefined ? {} : { op: change.op }) };
        case "group": return { ...node, ...(change.op === undefined ? {} : { op: change.op, synthetic: false }) };
      }
    });
  }

  /** Adds a condition, boolean group or related-record group. Returns its stable draft ID. */
  add(parent: string, kind: FilterNode["kind"] = "condition"): string {
    const id = this.#id();
    let node: FilterNode;
    switch (kind) {
      case "condition": node = { kind, id, field: "", op: "eq", mode: "value", text: "", other: "", caseInsensitive: false }; break;
      case "group": node = { kind, id, op: "or", children: [] }; break;
      case "related": node = { kind, id, field: "", op: "any", children: [] }; break;
    }
    this.#map(parent, (p) => p.kind === "condition" ? p : { ...p, children: [...p.children, node] });
    return id;
  }

  /** Removes a clause and its descendants. The root remains available for adding conditions. */
  remove(id: string): void {
    const walk = (node: FilterNode): FilterNode => node.kind === "condition" ? node : { ...node, children: node.children.filter((c) => c.id !== id).map(walk) };
    this.#root.value = walk(this.#root.peek()) as FilterGroup;
  }

  /** Entity type in scope at a clause; undefined while an ancestor navigation is invalid. */
  typeFor(id: string): EntityType | undefined {
    const walk = (node: FilterNode, type: EntityType | undefined): EntityType | undefined => {
      if (node.id === id) return type;
      if (node.kind === "condition") return undefined;
      const nav = node.kind === "related" ? type?.navigation(node.field) : undefined;
      const childType = node.kind === "related" ? nav ? this.schema.set(nav.target).type : undefined : type;
      for (const child of node.children) { const found = walk(child, childType); if (found) return found; }
      return undefined;
    };
    return walk(this.#root.value, this.schema.set(this.set).type);
  }

  #id(): string { return `c${++this.#sequence}`; }
  #map(id: string, update: (node: FilterNode) => FilterNode): void {
    const walk = (n: FilterNode): FilterNode => n.id === id ? update(n) : n.kind === "condition" ? n : { ...n, children: n.children.map(walk) };
    this.#root.value = walk(this.#root.peek()) as FilterGroup;
  }

  #from(c: Criteria): FilterNode {
    const id = this.#id();
    switch (c.op) {
      case "and": case "or": return { kind: "group", id, op: c.op, children: c.args.map((a) => this.#from(a)) };
      case "not": return { kind: "group", id, op: "not", children: [this.#from(c.arg)] };
      case "any": case "all": case "via": return { kind: "related", id, op: c.op, field: c.field, children: [this.#from(c.where)] };
      default: {
        const other = "other" in c ? c.other : "";
        const value = "value" in c ? c.value : undefined;
        const relative = typeof value === "object" && value !== null;
        const op = value === null && (c.op === "eq" || c.op === "ne") ? c.op === "eq" ? "isnull" : "notnull" : c.op;
        return { kind: "condition", id, op, field: c.field, mode: other ? "field" : relative ? "relative" : "value", other,
          text: c.op === "in" ? JSON.stringify(c.values) : relative ? JSON.stringify(value) : value === undefined || value === null ? "" : String(value),
          caseInsensitive: "caseInsensitive" in c && c.caseInsensitive === true };
      }
    }
  }

  #compile(node: FilterNode, type: EntityType, problems: FilterProblem[]): Criteria | undefined {
    try {
      let result: Criteria;
      switch (node.kind) {
        case "group": {
          if (!node.children.length) throw new Error("Add a condition or remove this empty group.");
          const children = node.children.map((n) => this.#compile(n, type, problems)).filter((c): c is Criteria => c !== undefined);
          switch (node.op) {
            case "and": case "or": result = node.synthetic && children.length === 1 ? children[0]! : { op: node.op, args: children }; break;
            case "not": result = { op: "not", arg: children.length === 1 ? children[0]! : { op: "and", args: children } }; break;
            default: throw new Error(`Unknown group operator ${node.op}`);
          }
          break;
        }
        case "related": {
          const nav = type.navigation(node.field);
          if (!nav) throw new Error(`Choose a related field; ${node.field || "(none)"} is unavailable.`);
          if (nav.collection ? node.op !== "any" && node.op !== "all" : node.op !== "via") throw new Error("Choose an operator matching the relationship.");
          if (!node.children.length) throw new Error("Add a related-record condition.");
          const children = node.children.map((c) => this.#compile(c, this.schema.set(nav.target).type, problems)).filter((c): c is Criteria => c !== undefined);
          result = { op: node.op as "any" | "all" | "via", field: node.field, where: children.length === 1 ? children[0]! : { op: "and", args: children } };
          break;
        }
        case "condition": {
          const field = type.field(node.field);
          if (!field) throw new Error(`Choose a field; ${node.field || "(none)"} is unavailable. Use a related group for related fields.`);
          if (!filterOperators(field).includes(node.op)) throw new Error(`Choose an operator supported by ${field.title ?? field.name}.`);
          const fieldName = node.field;
          switch (node.op) {
            case "isnull": case "notnull": result = { op: node.op === "isnull" ? "eq" : "ne", field: fieldName, value: null }; break;
            case "contains": case "startswith": case "endswith":
              if (node.mode !== "value") throw new Error("Text matching requires a literal value.");
              result = { op: node.op, field: fieldName, value: node.text, ...(node.caseInsensitive ? { caseInsensitive: true } : {}) }; break;
            case "in": {
              if (node.mode !== "value") throw new Error("A list requires literal values.");
              const values: unknown = JSON.parse(node.text);
              if (!Array.isArray(values) || values.some((v) => v !== null && !["string", "number", "boolean"].includes(typeof v))) throw new Error("Enter a JSON array of typed values.");
              if (field.allowedValues && (!values.length || values.some((v) => v !== null && !field.allowedValues!.some((o) => o.value === v)))) throw new Error("Choose one or more of the offered values.");
              result = { op: "in", field: fieldName, values: values as Value[] }; break;
            }
            default: {
              const op = node.op as "eq" | "ne" | "gt" | "ge" | "lt" | "le";
              if (node.mode === "field") {
                if (!node.other) throw new Error("Choose a comparison field.");
                result = { op, field: fieldName, other: node.other };
              } else if (node.mode === "relative") {
                const value: RelativeDate = JSON.parse(node.text);
                if (!value || !["today", "now"].includes(value.relative) || Object.keys(value).some((k) => !["relative", "days", "weeks", "months", "startOf"].includes(k)) || [value.days, value.weeks, value.months].some((v) => v !== undefined && !Number.isSafeInteger(v)) || (value.startOf !== undefined && value.startOf !== "week" && value.startOf !== "month")) throw new Error("Enter a valid relative date.");
                result = { op, field: fieldName, value };
              } else {
                const value = literal(node.text, field);
                if (field.allowedValues && !field.allowedValues.some((o) => o.value === value)) throw new Error("Choose one of the offered values.");
                result = { op, field: fieldName, value };
              }
            }
          }
          break;
        }
      }
      // Validate each subtree in its entity scope without resolving stored relative dates.
      const resolved = resolveRelative(result, type, Date.now(), relatedOf(this.schema, type));
      toFilter(resolved, type, undefined, this.schema);
      return result;
    } catch (error) { problems.push({ id: node.id, message: error instanceof Error ? error.message : String(error) }); return undefined; }
  }
}

function literal(text: string, field: Field): Value {
  switch (field.type) {
    case "Edm.String": return text;
    case "Edm.Boolean": if (text !== "true" && text !== "false") throw new Error("Choose Yes or No."); return text === "true";
    case "Edm.Byte": case "Edm.SByte": case "Edm.Int16": case "Edm.Int32": case "Edm.Single": case "Edm.Double":
      if (!text.trim() || !Number.isFinite(Number(text))) throw new Error("Enter a number."); return Number(text);
    default: if (!text.trim()) throw new Error("Enter a value."); return text.trim();
  }
}

/** A readable bracketed expression using metadata titles; this is not executable text. */
export function describeCriteria(criteria: Criteria | undefined, type: EntityType): string {
  if (!criteria) return "No advanced filter";
  const title = (name: string) => type.field(name)?.title ?? name;
  switch (criteria.op) {
    case "and": case "or": return `(${criteria.args.map((c) => describeCriteria(c, type)).join(criteria.op === "and" ? " AND " : " OR ")})`;
    case "not": return `NOT (${describeCriteria(criteria.arg, type)})`;
    case "any": case "all": case "via": return `${criteria.op === "any" ? "Any" : criteria.op === "all" ? "Every" : "Related"} ${criteria.field}: (${describeCriteria(criteria.where, type)})`;
    default: {
      const labels = { eq: "equals", ne: "does not equal", gt: "is greater than", ge: "is at least", lt: "is less than", le: "is at most", in: "is one of", contains: "contains", startswith: "starts with", endswith: "ends with" };
      const value = "other" in criteria ? title(criteria.other) : "values" in criteria ? criteria.values.map(describeValue).join(", ") || "(no values)" : describeValue(criteria.value);
      return `${title(criteria.field)} ${labels[criteria.op]} ${value}${"caseInsensitive" in criteria && criteria.caseInsensitive ? " (ignoring case)" : ""}`;
    }
  }
}

function describeValue(value: Value | RelativeDate): string {
  if (value === null) return "empty (null)";
  if (typeof value !== "object") return JSON.stringify(value);
  const parts = [value.relative === "today" ? "today (UTC)" : "now"];
  if (value.startOf) parts.push(`aligned to start of ${value.startOf}`);
  for (const unit of ["months", "weeks", "days"] as const) if (value[unit]) parts.push(`${value[unit]! > 0 ? "+" : ""}${value[unit]} ${unit}`);
  return parts.join(", ");
}
