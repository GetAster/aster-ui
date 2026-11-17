/** DOM-free Grid state helpers shared by browser presentations. */
export { sortBy, nudgeColumn, moveColumn, setWidth, freezeThrough, type GridView } from "./grid/view.ts";
export { policyPermits } from "./grid/policy.ts";
export type { Capability, FieldPolicy, GridPolicy } from "./grid/policy.ts";
