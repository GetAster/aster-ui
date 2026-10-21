import type { Criteria } from "../criteria/ast.ts";
import { matches } from "../criteria/evaluate.ts";
import { resolveRelative } from "../criteria/relative.ts";
import type { Rule } from "../edit/edit-model.ts";
import type { EntityType } from "../schema/model.ts";

/** A test of a field's own value: a comparison without its field (`{ op: "gt", value: 0 }`). */
export type OwnTest = Criteria extends infer C ? (C extends { readonly field: string } ? Omit<C, "field"> : never) : never;

/** Criteria whose leaves may leave out the field, meaning the validated one. */
export type OwnCriteria =
  | Criteria
  | OwnTest
  | { readonly op: "and" | "or"; readonly args: readonly OwnCriteria[] }
  | { readonly op: "not"; readonly arg: OwnCriteria };

/**
 * A validator written as criteria: the value passes while `passWhen` holds,
 * or fails while `failWhen` does. A test without a field is about the
 * field itself; one that names fields reads the record. A null value isn't
 * checked; required is its own rule.
 */
export interface CriteriaValidator {
  readonly passWhen?: OwnCriteria;
  readonly failWhen?: OwnCriteria;
  readonly message: string;
}

/** `validator` on `field` as an edit model rule. */
export function criteriaRule(type: EntityType, field: string, validator: CriteriaValidator, now: () => number = Date.now): Rule {
  const test = validator.passWhen ?? validator.failWhen;
  if (!test || (validator.passWhen && validator.failWhen)) throw new Error("a criteria validator has one of passWhen and failWhen");
  const criteria = own(test, field);
  return (values) => {
    if ((values[field] ?? null) === null) return {};
    const holds = matches(resolveRelative(criteria, type, now()), values, type);
    return { [field]: holds === (validator.passWhen !== undefined) ? undefined : validator.message };
  };
}

function own(c: OwnCriteria, field: string): Criteria {
  if ("args" in c) return { op: c.op as "and" | "or", args: c.args.map((a) => own(a, field)) };
  if ("arg" in c) return { op: "not", arg: own(c.arg, field) };
  return ("field" in c ? c : { ...c, field }) as Criteria;
}
