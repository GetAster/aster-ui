import { signal } from "@preact/signals-core";
import type { EntityType } from "@getaster/data";
import { validateFieldSelectionDepth, validateFieldSelectionFilter, validateFieldSelectionPolicy, validateFieldSelectionSource, validateFieldSelectionValue } from "./config.ts";

import type { FieldSelectionOption, FieldSelectionSource, FieldSelectionFilter, FieldSelectionPolicy, SelectedField, FieldSelectionChange, FieldSelectionRow } from "./types.ts";
export type { FieldSelectionOption, FieldSelectionSource, FieldSelectionFilter, FieldSelectionPolicy, SelectedField, FieldSelectionChange, FieldSelectionRow } from "./types.ts";

/** Metadata-only selection; each expansion visits exactly one relationship level. */
export class FieldSelectionModel {
  readonly #source = signal<FieldSelectionSource | undefined>(undefined);
  readonly #value = signal<readonly string[]>([]);
  readonly #filter = signal<FieldSelectionFilter>("all");
  readonly #search = signal("");
  readonly #expanded = signal<ReadonlySet<string>>(new Set());
  readonly #maxDepth = signal(8);
  readonly #policy = signal<Readonly<Record<string, FieldSelectionPolicy>>>({});

  constructor(source?: FieldSelectionSource, value: readonly string[] = []) {
    this.source = source;
    this.value = value;
  }

  get source(): FieldSelectionSource | undefined { return this.#source.value; }
  set source(value: FieldSelectionSource | undefined) {
    if (value !== undefined) value = validateFieldSelectionSource(value);
    const previous = this.#source.peek();
    if (value === previous) return;
    if (value && previous) {
      if ("schema" in value && "schema" in previous && value.schema === previous.schema && value.entitySet === previous.entitySet) return;
      if ("fields" in value && "fields" in previous && value.fields.length === previous.fields.length
        && value.fields.every((field, index) => field.path === previous.fields[index]?.path && field.label === previous.fields[index]?.label)) return;
    }
    for (const path of this.#value.peek()) this.#resolve(path, value);
    this.#source.value = value;
    this.#expanded.value = new Set();
  }

  get value(): readonly string[] { return this.#value.value; }
  set value(value: readonly string[]) {
    const next = validateFieldSelectionValue(value);
    for (const path of next) this.#resolve(path);
    this.#value.value = next;
  }

  get filter(): FieldSelectionFilter { return this.#filter.value; }
  set filter(value: FieldSelectionFilter) {
    this.#filter.value = validateFieldSelectionFilter(value);
  }
  get search(): string { return this.#search.value; }
  set search(value: string) { this.#search.value = value; }
  get maxDepth(): number { return this.#maxDepth.value; }
  set maxDepth(value: number) {
    this.#maxDepth.value = validateFieldSelectionDepth(value);
  }
  get policy(): Readonly<Record<string, FieldSelectionPolicy>> { return this.#policy.value; }
  set policy(value: Readonly<Record<string, FieldSelectionPolicy>>) { this.#policy.value = validateFieldSelectionPolicy(value); }

  get selected(): readonly SelectedField[] { return this.value.map((path) => this.#resolve(path)); }

  get change(): FieldSelectionChange { return { value: [...this.value], fields: this.selected }; }

  /** Refusals apply to user actions; a host can restore an authored value directly. */
  selectionReason(path: string): string | undefined {
    this.#resolve(path);
    const policy = this.policy[path];
    return this.value.includes(path) ? policy?.hide : policy?.select;
  }

  select(path: string, selected: boolean): boolean {
    this.#resolve(path);
    const current = this.value;
    if (current.includes(path) === selected || this.selectionReason(path) !== undefined) return false;
    this.value = selected ? [...current, path] : current.filter((field) => field !== path);
    return true;
  }

  moveReason(path: string, direction: -1 | 1): string | undefined {
    this.#resolve(path);
    const current = this.value;
    const index = current.indexOf(path);
    if (index < 0) return "Select this field before moving it.";
    if (this.policy[path]?.move !== undefined) return this.policy[path]!.move;
    if (index + direction < 0 || index + direction >= current.length) return "Already at the end of the selection.";
    return undefined;
  }

  move(path: string, direction: -1 | 1): boolean {
    if (direction !== -1 && direction !== 1) throw new Error("Move direction must be -1 or 1");
    if (this.moveReason(path, direction) !== undefined) return false;
    const next = [...this.value];
    const index = next.indexOf(path);
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    this.value = next;
    return true;
  }

  toggle(path: string): boolean {
    const branch = this.#branch(path);
    if (!branch) throw new Error(`Unknown relationship path: ${path}`);
    const expanded = new Set(this.#expanded.value);
    if (expanded.has(path)) expanded.delete(path);
    else {
      if (this.#parts(path).length >= this.maxDepth) return false;
      expanded.add(path);
    }
    this.#expanded.value = expanded;
    return true;
  }

  get rows(): readonly FieldSelectionRow[] {
    const source = this.source;
    if (!source) return [];
    const filter = this.filter;
    const search = this.search.trim().toLocaleLowerCase();
    const matches = (field: SelectedField) => !search || `${field.path} ${field.label}`.toLocaleLowerCase().includes(search);
    if ("fields" in source) return source.fields.map((field) => ({ ...this.#resolve(field.path), localLabel: field.label ?? field.path, selectedCount: 0, depth: 0,
      branch: false, collection: false, expanded: false })).filter((field) => this.#visible(field.path, filter) && matches(field));
    const expanded = this.#expanded.value;
    const visit = (type: EntityType, paths: readonly string[], labels: readonly string[]): FieldSelectionRow[] => {
      const rows: FieldSelectionRow[] = type.fields.map((field) => ({ path: [...paths, field.name].join("/"),
        label: [...labels, field.title ?? field.name].join(" › "), localLabel: field.title ?? field.name, selectedCount: 0, depth: paths.length, branch: false, collection: false, expanded: false }))
        .filter((field) => this.#visible(field.path, filter) && matches(field));
      if (filter === "direct" || paths.length >= this.maxDepth) return rows;
      for (const navigation of type.navigations) {
        const next = [...paths, navigation.name];
        const path = next.join("/");
        const localLabel = navigation.title ?? navigation.name;
        const label = [...labels, localLabel].join(" › ");
        const limited = next.length >= this.maxDepth;
        const open = !limited && expanded.has(path);
        const children = open ? visit(source.schema.set(navigation.target).type, next, [...labels, localLabel]) : [];
        if (matches({ path, label }) || children.length) rows.push({ path, label, localLabel, selectedCount: this.value.filter(value => value.startsWith(`${path}/`)).length, depth: paths.length, branch: true,
          collection: navigation.collection, expanded: open, ...(limited ? { reason: `Maximum relationship depth (${this.maxDepth}) reached.` } : {}) }, ...children);
      }
      return rows;
    };
    return visit(source.schema.set(source.entitySet).type, [], []);
  }

  #visible(path: string, filter: FieldSelectionFilter): boolean {
    switch (filter) {
      case "all": return true;
      case "direct": return !path.includes("/");
      case "related": return path.includes("/");
    }
  }

  #parts(path: string): string[] {
    const parts = path.split("/");
    if (parts.some((part) => !part || part.trim() !== part)) throw new Error(`Invalid field path: ${path}`);
    return parts;
  }

  #resolve(path: string, source = this.source): SelectedField {
    const parts = this.#parts(path);
    if (!source) throw new Error(`Field selection has no source: ${path}`);
    if ("fields" in source) {
      const field = source.fields.find((field) => field.path === path);
      if (!field) throw new Error(`Unknown field path: ${path}`);
      return { path, label: field.label ?? parts.join(" › ") };
    }
    let type = source.schema.set(source.entitySet).type;
    const labels: string[] = [];
    for (const part of parts.slice(0, -1)) {
      const navigation = type.navigation(part);
      if (!navigation) throw new Error(`Unknown relationship in field path: ${path}`);
      labels.push(navigation.title ?? navigation.name);
      type = source.schema.set(navigation.target).type;
    }
    const field = type.field(parts.at(-1)!);
    if (!field) throw new Error(`Unknown field path: ${path}`);
    return { path, label: [...labels, field.title ?? field.name].join(" › ") };
  }

  #branch(path: string): boolean {
    const source = this.source;
    if (!source || !("schema" in source)) return false;
    let type = source.schema.set(source.entitySet).type;
    for (const part of this.#parts(path)) {
      const navigation = type.navigation(part);
      if (!navigation) return false;
      type = source.schema.set(navigation.target).type;
    }
    return true;
  }
}
