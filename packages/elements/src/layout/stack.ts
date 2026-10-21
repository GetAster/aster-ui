import { html, nothing } from "lit-html";
import { defineElement, elementProperty } from "../composition/element.ts";
import { compositeTypes as t } from "../composition/contracts.ts";
import type { View } from "../base/element.ts";

const choice = <const T extends readonly string[]>(...values: T) => t.custom(values.join(" | "), (v): v is T[number] => values.includes(v as string), { enum: values });
const content = t.custom("content template", (v): v is View => v === nothing || !!v && typeof v === "object" && "_$litType$" in v);
const properties = {
  gap: elementProperty(choice("none", "small", "medium", "large"), () => "medium" as const, "gap"),
  align: elementProperty(choice("stretch", "start", "center", "end", "baseline"), () => "stretch" as const, "align"),
  justify: elementProperty(choice("start", "center", "end", "space-between", "space-around"), () => "start" as const, "justify"),
  wrap: elementProperty(t.boolean, () => false, "wrap"),
  responsive: elementProperty(t.boolean, () => true, "responsive"),
  content: elementProperty(content, () => nothing as View, "content"),
};
function stack(tag: string, direction: "horizontal" | "vertical") {
  return defineElement({ tag, properties: { ...properties, direction: elementProperty(choice("horizontal", "vertical"), () => direction, "Layout direction") },
    render: p => html`<div class="aster-stack" data-direction=${p.direction} data-gap=${p.gap} data-align=${p.align} data-justify=${p.justify} ?data-wrap=${p.wrap} ?data-responsive=${p.responsive}>${p.content}</div>`,
  });
}
export const Stack = stack("aster-stack", "vertical");
export const HorizontalLayout = stack("aster-horizontal-layout", "horizontal");
export const VerticalLayout = stack("aster-vertical-layout", "vertical");
