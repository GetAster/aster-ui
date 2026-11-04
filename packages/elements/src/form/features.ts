/**
 * How the form behaves. A descriptor says how, never whether: switching a
 * presentation feature off is [[object:FormChrome]]'s job. Plain data, so a
 * composition catalog can carry it.
 */
export type FormFeature =
  | { readonly kind: "validation"; readonly on?: "change" | "exit" }
  | { readonly kind: "save" };

/** When a field revalidates: only when the host validates, on change, or on exit. */
export type ValidateOn = "submit" | "change" | "exit";

/** One descriptor of `kind`, if the page gave one. */
export function formFeature<K extends FormFeature["kind"]>(
  features: readonly FormFeature[] | undefined,
  kind: K,
): Extract<FormFeature, { kind: K }> | undefined {
  return features?.find((entry): entry is Extract<FormFeature, { kind: K }> => entry.kind === kind);
}

/** The features with `next` replacing the first descriptor of its kind, or appended. */
export function withFormFeature(features: readonly FormFeature[] | undefined, next: FormFeature): FormFeature[] {
  const list = [...(features ?? [])];
  const at = list.findIndex((entry) => entry.kind === next.kind);
  if (at < 0) list.push(next);
  else list[at] = next;
  return list;
}

/** The features without the descriptor of `kind`. */
export function withoutFormFeature(features: readonly FormFeature[] | undefined, kind: FormFeature["kind"]): FormFeature[] {
  return (features ?? []).filter((entry) => entry.kind !== kind);
}

/** The validation timing; absent means validation happens when the host validates or saves. */
export function validationOn(features: readonly FormFeature[] | undefined): ValidateOn {
  return formFeature(features, "validation")?.on ?? "submit";
}

/** Whether Enter in a single-line field saves the model. */
export function savesOnEnter(features: readonly FormFeature[] | undefined): boolean {
  return formFeature(features, "save") !== undefined;
}

/** Checks a features value: known kinds, plain fields and valid unions. */
export function validateFormFeatures(value: unknown): asserts value is readonly FormFeature[] {
  if (!Array.isArray(value)) throw new TypeError("features must be an array");
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("each feature must be a plain object");
    const kind = (entry as { kind?: unknown }).kind;
    if (kind !== "validation" && kind !== "save") throw new TypeError(`unknown feature kind: ${String(kind)}`);
    if (seen.has(kind)) throw new TypeError(`feature "${kind}" appears more than once`);
    seen.add(kind);
    switch (kind) {
      case "validation": {
        const on = (entry as { on?: unknown }).on;
        if (on !== undefined && on !== "change" && on !== "exit") throw new TypeError('validation.on must be "change" or "exit"');
        break;
      }
      case "save":
        break;
    }
  }
}
