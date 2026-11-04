/** A capability switch: on or off, a field-name allowlist, or a predicate. */
export type Capability = boolean | readonly string[] | ((field: string) => boolean);

/** The plain-data form a composition catalog can carry. Predicates stay in JavaScript. */
export type CapabilityValue = boolean | readonly string[];

/**
 * Per-field capability overrides. They narrow the global entry; they never
 * grant what it refuses.
 */
export interface FieldPolicy {
  /** Whether this field may be sorted, when the global entry permits it. */
  sortable?: Capability;
  /** Whether this field may be filtered, when the global entry permits it. */
  filterable?: Capability;
  /** Whether this field may be grouped on, when the global entry permits it. */
  groupable?: Capability;
  /** Whether this field's column may be resized, when the global entry permits it. */
  resizable?: Capability;
  /** Whether this field's column may be moved, when the global entry permits it. */
  movable?: Capability;
  /** Whether this field's column may be hidden, when the global entry permits it. */
  hideable?: Capability;
  /** Whether this field's column may be frozen, when the global entry permits it. */
  freezable?: Capability;
  /** Whether this field may be edited, when the global entry permits it. */
  editable?: Capability;
}

/**
 * What the page allows, keyed by field name. Policy can only restrict:
 * schema and the grid's own structure refuse first, and a page rule's
 * read-only reason outranks a policy reason. It never joins [[object:GridView]]:
 * a saved view cannot carry another person's capabilities.
 */
export interface GridPolicy {
  /** Global sort capability, default on. */
  sortable?: Capability;
  /** Global filter capability, default on. */
  filterable?: Capability;
  /** Global grouping capability, default on. */
  groupable?: Capability;
  /** Global column-resize capability, default on. */
  resizable?: Capability;
  /** Global column-move capability, default on. */
  movable?: Capability;
  /** Global column-hide capability, default on. */
  hideable?: Capability;
  /** Global column-freeze capability, default on. */
  freezable?: Capability;
  /** Global edit capability, default off. */
  editable?: Capability;
  /** Whether rows may be selected, default on. */
  selectable?: boolean;
  /** Per-field overrides, by field name. */
  fields?: Readonly<Record<string, FieldPolicy>>;
}

/** One entry's answer for `field`; `fallback` when the entry says nothing. */
export function permits(entry: Capability | undefined, field: string, fallback: boolean): boolean {
  if (entry === undefined) return fallback;
  switch (typeof entry) {
    case "boolean":
      return entry;
    case "function":
      return entry(field);
    default:
      return entry.includes(field);
  }
}

/** The host's answer: the global entry, narrowed by the field's own entry. */
export function policyPermits(policy: GridPolicy, capability: keyof FieldPolicy, field: string, fallback: boolean): boolean {
  return permits(policy[capability], field, fallback) && permits(policy.fields?.[field]?.[capability], field, true);
}
