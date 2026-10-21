export interface Param {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly description: string;
}

export interface Entry {
  readonly ref: string;
  readonly kind: string;
  readonly name: string;
  readonly package: string;
  readonly definingClass?: string;
  readonly tag?: string;
  readonly inheritsFrom?: string;
  readonly valueType?: string;
  readonly defaultValue?: string;
  readonly flags?: string;
  readonly params?: readonly Param[];
  readonly returns?: { readonly type: string; readonly description: string };
  readonly description: string;
  readonly seeAlso: readonly string[];
  readonly groups: readonly string[];
  readonly source: string;
  readonly deprecated?: string;
}

