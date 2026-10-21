import type { Value } from "../schema/model.ts";

/**
 * A date relative to when a query runs: today, or now, taken to the start
 * of its week (Monday) or month if asked, then moved by whole units. It stays
 * symbolic in a query or a published filter and is resolved at each fetch,
 * so "due this week" is still right next week.
 */
export interface RelativeDate {
  readonly relative: "today" | "now";
  readonly days?: number;
  readonly weeks?: number;
  readonly months?: number;
  readonly startOf?: "week" | "month";
}

/**
 * Compiled to `$filter`, and evaluated locally with the same OData semantics.
 * Comparisons are property against literal, or property against property of
 * the same type, so local evaluation can match the server exactly.
 */
export type Criteria =
  | { readonly op: "and" | "or"; readonly args: readonly Criteria[] }
  | { readonly op: "not"; readonly arg: Criteria }
  | {
      readonly op: "eq" | "ne" | "gt" | "ge" | "lt" | "le";
      readonly field: string;
      /** A relative date on a date field; resolved (`resolveRelative`) before compiling or evaluating. */
      readonly value: Value | RelativeDate;
    }
  | {
      readonly op: "eq" | "ne" | "gt" | "ge" | "lt" | "le";
      readonly field: string;
      /** Another property of the same type, compared with `field`. */
      readonly other: string;
    }
  | { readonly op: "in"; readonly field: string; readonly values: readonly Value[] }
  | {
      readonly op: "contains" | "startswith" | "endswith";
      readonly field: string;
      readonly value: string;
      /** Compare through `tolower()` on both sides. */
      readonly caseInsensitive?: boolean;
    }
  /**
   * Over a to-many navigation (`answers`): some related record matches
   * `where`, or every one does (so `all` of none holds). `where` names the
   * related records' properties.
   */
  | { readonly op: "any" | "all"; readonly field: string; readonly where: Criteria }
  /**
   * Through a single-valued navigation (`project`): the related record
   * matches `where`, which names its properties. Compiles to a path
   * (`project/health eq 'behind'`); with no related record its properties
   * are null, as on the server.
   */
  | { readonly op: "via"; readonly field: string; readonly where: Criteria };

export interface SortKey {
  readonly field: string;
  readonly descending?: boolean;
}

/** The query a collection is a window over. */
export interface Query {
  readonly set: string;
  readonly filter?: Criteria;
  /** The key properties are appended as tie-breakers, as the server does. */
  readonly orderBy?: readonly SortKey[];
  readonly select?: readonly string[];
}
