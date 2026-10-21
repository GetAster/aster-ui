// aster-ui.js: the data layer and the elements as one ES module, with
// lit-html and signals inside.
export * from "@getaster/data";
export * from "@getaster/elements";
// Both packages name something Field: here it's the element, and the metadata type is FieldMeta.
export { Field } from "@getaster/elements";
export type { Field as FieldMeta } from "@getaster/data";
export { effect, computed, signal, batch, untracked, type ReadonlySignal, type Signal } from "@preact/signals-core";
export { html, nothing, render, svg, type TemplateResult } from "lit-html";
