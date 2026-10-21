import type { Entity, EntityType, Value } from "../schema/model.ts";

/** Key values in key order. */
export type KeyValues = readonly Value[];

/** A key as a map key: equal keys always give the same text. */
export type KeyText = string;

export function keyValues(type: EntityType, entity: Entity): KeyValues {
  return type.key.map((name) => {
    const v = entity[name];
    if (v === undefined || v === null) {
      throw new Error(`${type.name} has no value for key property ${name}`);
    }
    return v;
  });
}

export function keyText(key: KeyValues): KeyText {
  return JSON.stringify(key);
}

export function keyOf(type: EntityType, entity: Entity): KeyText {
  return keyText(keyValues(type, entity));
}

export function hasKey(type: EntityType, entity: Entity): boolean {
  return type.key.every((name) => entity[name] !== undefined && entity[name] !== null);
}

export function keyFromText(text: KeyText): KeyValues {
  return JSON.parse(text) as KeyValues;
}
