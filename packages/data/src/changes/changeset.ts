import type { Entity, EntityType, Value } from "../schema/model.ts";
import type { KeyValues } from "../store/keys.ts";

export interface FieldChange {
  readonly from: Value;
  readonly to: Value;
}

/** Changes to a record's owned collections, by navigation name: one per child record added, updated or removed. */
export type OwnedChanges = Readonly<Record<string, readonly ChangeSet[]>>;

/**
 * What a save changed, as data: it can be stored, sent, inverted for undo and
 * replayed over its old values. An update can carry its owned collections'
 * changes, so one record's edit across nested editors is one change set.
 */
export type ChangeSet =
  | { readonly kind: "create"; readonly set: string; readonly values: Entity }
  | {
      readonly kind: "update";
      readonly set: string;
      readonly key: KeyValues;
      readonly changes: Readonly<Record<string, FieldChange>>;
      readonly owned?: OwnedChanges;
    }
  | { readonly kind: "delete"; readonly set: string; readonly key: KeyValues; readonly values: Entity };

/** Field changes from `baseline` to `current`; only fields present in `current` count. */
export function diff(baseline: Entity, current: Entity): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  for (const [name, to] of Object.entries(current)) {
    const from = baseline[name] ?? null;
    if (!Object.is(from, to)) out[name] = { from, to };
  }
  return out;
}

export function isEmpty(changes: Readonly<Record<string, FieldChange>>): boolean {
  return Object.keys(changes).length === 0;
}

export function apply(entity: Entity, changes: Readonly<Record<string, FieldChange>>): Entity {
  const out: Record<string, Value> = { ...entity };
  for (const [name, c] of Object.entries(changes)) out[name] = c.to;
  return out;
}

/**
 * The change that undoes `change`. Undoing a create needs the created record's
 * key; undoing a delete recreates it without its server-computed properties.
 */
export function invert(change: ChangeSet, type: EntityType, created?: KeyValues): ChangeSet {
  switch (change.kind) {
    case "create":
      if (!created) throw new Error("Undoing a create needs the created record's key");
      return { kind: "delete", set: change.set, key: created, values: change.values };
    case "update": {
      const changes: Record<string, FieldChange> = {};
      for (const [name, c] of Object.entries(change.changes)) changes[name] = { from: c.to, to: c.from };
      if (change.owned) throw new Error("Undoing owned changes needs each child's type and keys; undo them one by one");
      return { kind: "update", set: change.set, key: change.key, changes };
    }
    case "delete":
      return { kind: "create", set: change.set, values: writable(type, change.values) };
  }
}

/** Two updates of one record as one: first `from`, last `to`; fields that end where they began drop out. */
export function merge(
  a: Readonly<Record<string, FieldChange>>,
  b: Readonly<Record<string, FieldChange>>,
): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = { ...a };
  for (const [name, c] of Object.entries(b)) {
    const first = out[name];
    out[name] = first ? { from: first.from, to: c.to } : c;
  }
  for (const [name, c] of Object.entries(out)) if (Object.is(c.from, c.to)) delete out[name];
  return out;
}

/** The properties a client may send: computed ones are the server's. */
export function writable(type: EntityType, values: Entity): Entity {
  const out: Record<string, Value> = {};
  for (const [name, v] of Object.entries(values)) {
    const field = type.field(name);
    if (field && !field.computed) out[name] = v;
  }
  return out;
}

/**
 * What a create sends: the writable values that differ from what the server
 * would store without them (the field's `$DefaultValue`, else null).
 */
export function creatable(type: EntityType, values: Entity): Entity {
  const out: Record<string, Value> = {};
  for (const [name, v] of Object.entries(writable(type, values))) {
    if (!Object.is(v, type.field(name)!.defaultValue ?? null)) out[name] = v;
  }
  return out;
}
