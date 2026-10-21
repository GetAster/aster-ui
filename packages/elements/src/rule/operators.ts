import type { Value } from "@getaster/data";

/** Metadata labels used by persisted rule clauses. */
export function opLabel(allowed: readonly { readonly value: Value; readonly label?: string }[] | undefined, op: Value | undefined): string {
  return allowed?.find((a) => a.value === op)?.label ?? String(op ?? "");
}

/** Human labels shared by general query condition controls. */
export function filterOperatorLabel(op: string): string {
  const labels: Readonly<Record<string, string>> = { eq: "equals", ne: "does not equal", gt: "greater than", ge: "at least", lt: "less than", le: "at most", in: "is one of", isnull: "is null", notnull: "is not null", contains: "contains", startswith: "starts with", endswith: "ends with", and: "All", or: "Any", not: "Not all", any: "Any related record", all: "Every related record", via: "Related record" };
  return labels[op] ?? op;
}
