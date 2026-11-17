import type { Schema } from "@getaster/data";

export interface FieldSelectionOption {
  readonly path: string;
  readonly label?: string;
}

export type FieldSelectionSource =
  | { readonly schema: Schema; readonly entitySet: string }
  | { readonly fields: readonly FieldSelectionOption[] };

export type FieldSelectionFilter = "all" | "direct" | "related";

/** A reason refuses that action; omitted actions are allowed. */
export interface FieldSelectionPolicy {
  readonly select?: string;
  readonly hide?: string;
  readonly move?: string;
}

export interface SelectedField {
  readonly path: string;
  /** Complete labelled path, relative to the source. */
  readonly label: string;
}

export interface FieldSelectionChange {
  readonly value: readonly string[];
  readonly fields: readonly SelectedField[];
}

export interface FieldSelectionRow extends SelectedField {
  /** Label of this field or relationship, without its ancestors. */
  readonly localLabel: string;
  /** Selected scalar descendants, including those hidden by collapse or search. */
  readonly selectedCount: number;
  readonly depth: number;
  readonly branch: boolean;
  readonly collection: boolean;
  readonly expanded: boolean;
  readonly reason?: string;
}

