/**
 * Built only from CSDL JSON `$metadata` (`csdl.ts`).
 *
 * Values stay in their OData JSON form (`IEEE754Compatible=true`) so nothing
 * loses precision:
 *
 * | Edm type                         | JS value                         |
 * |----------------------------------|----------------------------------|
 * | String, Guid, Duration           | `string`                         |
 * | Boolean                          | `boolean`                        |
 * | Byte, SByte, Int16, Int32        | `number`                         |
 * | Single, Double                   | `number`                         |
 * | Int64, Decimal                   | `string` (exact decimal text)    |
 * | Date                             | `string` `YYYY-MM-DD`            |
 * | TimeOfDay                        | `string` `hh:mm:ss[.fff]`        |
 * | DateTimeOffset                   | `string` RFC 3339 with offset    |
 * | Binary                           | `string` base64url               |
 * | null                             | `null`                           |
 */
export type EdmType =
  | "Edm.String"
  | "Edm.Boolean"
  | "Edm.Byte"
  | "Edm.SByte"
  | "Edm.Int16"
  | "Edm.Int32"
  | "Edm.Int64"
  | "Edm.Single"
  | "Edm.Double"
  | "Edm.Decimal"
  | "Edm.Date"
  | "Edm.TimeOfDay"
  | "Edm.DateTimeOffset"
  | "Edm.Duration"
  | "Edm.Guid"
  | "Edm.Binary";

export type Value = string | number | boolean | null;

/** A record as the data core holds it: property name to value. */
export type Entity = Readonly<Record<string, Value>>;

/**
 * Annotations by qualified term name, with namespace aliases resolved to the
 * alias the vocabulary is known by here: `Core.Description`,
 * `Validation.Minimum`, `AsterData.DisplayField`.
 */
export type Annotations = Readonly<Record<string, unknown>>;

export interface AllowedValue {
  readonly value: Value;
  /** `Core.Description` on the allowed value: the label to show. */
  readonly label?: string;
}

export interface Field {
  readonly name: string;
  readonly type: EdmType;
  readonly nullable: boolean;
  readonly maxLength?: number;
  readonly precision?: number;
  readonly scale?: number;
  /** `Core.Description`. */
  readonly title?: string;
  /** `Core.LongDescription`. */
  readonly prompt?: string;
  /** `Core.Computed`: the server assigns it. */
  readonly computed: boolean;
  /** `Core.Immutable`: settable on create only. */
  readonly immutable: boolean;
  /** `Validation.AllowedValues`. */
  readonly allowedValues?: readonly AllowedValue[];
  /** `Validation.Pattern`. */
  readonly pattern?: string;
  /** `Validation.Minimum` / `Validation.Maximum`, as written in metadata. */
  readonly minimum?: number | string;
  readonly maximum?: number | string;
  /** `Validation.Exclusive` on the minimum or maximum. */
  readonly exclusiveMinimum?: boolean;
  readonly exclusiveMaximum?: boolean;
  /** `AsterData.MinLength`. */
  readonly minLength?: number;
  /** `AsterData.EmptyAsNull`: empty text entered becomes null. */
  readonly emptyAsNull?: boolean;
  /** `$DefaultValue`: what the server stores when a create leaves the field out. */
  readonly defaultValue?: Value;
  /** `AsterData.RootValue`, on a parent field: the value a root node holds. */
  readonly rootValue?: Value;
  readonly annotations: Annotations;
}

export interface Navigation {
  readonly name: string;
  /** Readable relationship label from Core.Description. */
  readonly title?: string;
  /** The entity set the navigation leads to. */
  readonly target: string;
  readonly collection: boolean;
  /** `[property of this type, property of the target]` pairs. */
  readonly keys: readonly (readonly [string, string])[];
  readonly partner?: string;
  /**
   * `AsterData.Owned`: children can't exist without the parent, and are
   * saved with it through deep insert and deep update with `@delta`.
   */
  readonly owned: boolean;
}

/** What a record-collection rule says of the working state. `deferred`: the client can't judge it, the server will. */
export type RuleOutcome = "pass" | "fail" | "deferred";

/** The working state a rule is judged over: the record's fields, and each loaded owned collection's rows by navigation name. */
export interface RuleState {
  readonly record: Entity;
  readonly rows: Readonly<Record<string, readonly Entity[]>>;
}

/**
 * An entity-level `Validation.Constraint`: a condition over the record and
 * its owned rows, published in `$metadata` and enforced by the server.
 */
export interface RecordRule {
  /** The annotation's qualifier, which the server reports as the failure's `code`. */
  readonly id: string;
  /** `FailureMessage`. */
  readonly message: string;
  /** Every part of the condition is one the client judges. */
  readonly evaluable: boolean;
  /** The navigations the condition reads. */
  readonly reads: readonly string[];
  /** The owned navigation the condition reads when it reads exactly one and nothing else; where a failure attaches. */
  readonly list: string | undefined;
  /** Judges the state. A part the client can't judge never decides the result unless it must: then `deferred`. */
  evaluate(state: RuleState): RuleOutcome;
}

export interface EntityType {
  readonly name: string;
  readonly qualifiedName: string;
  /** Key property names, in key order. */
  readonly key: readonly string[];
  /** In declaration order. */
  readonly fields: readonly Field[];
  readonly navigations: readonly Navigation[];
  /** `Validation.Constraint#id` on the type: rules over the record and its owned rows. */
  readonly rules: readonly RecordRule[];
  /** `Core.Description` on the type. */
  readonly title?: string;
  /** `AsterData.PluralTitle`. */
  readonly pluralTitle?: string;
  /** `AsterData.TitleField`. */
  readonly titleField?: string;
  readonly annotations: Annotations;
  field(name: string): Field | undefined;
  navigation(name: string): Navigation | undefined;
}

export interface EntitySet {
  readonly name: string;
  readonly type: EntityType;
  /** `Core.OptimisticConcurrency` is present: writes need `If-Match`. */
  readonly etag: boolean;
  /** `Capabilities.FilterRestrictions/NonFilterableProperties`. */
  readonly nonFilterable: ReadonlySet<string>;
  /** `Capabilities.SortRestrictions/NonSortableProperties`. */
  readonly nonSortable: ReadonlySet<string>;
  /**
   * `AsterData.CountThreshold`: below this many results the server's count
   * is exact; at or above it, it's estimated or left out unless a
   * collection asks for `exactCount`.
   */
  readonly countThreshold?: number;
  readonly annotations: Annotations;
}

/** A part of `$metadata` the client can't model and left out. */
export interface Skipped {
  readonly path: string;
  readonly reason: string;
}

export interface Schema {
  /** The namespace of the entity container. */
  readonly namespace: string;
  readonly sets: ReadonlyMap<string, EntitySet>;
  readonly types: ReadonlyMap<string, EntityType>;
  readonly skipped: readonly Skipped[];
  /** Throws if the set doesn't exist. */
  set(name: string): EntitySet;
}
