import { defineElement, elementProperty, compositeTypes as t } from "@getaster/elements";
import { html } from "lit-html";

// This declaration supplies JS accessors, YAML validation and property metadata.
export const DraftStatus = defineElement({
  tag: "demo-draft-status",
  properties: {
    label: elementProperty(t.string, () => "Draft", "Accessible status label"),
    dirty: elementProperty(t.boolean, () => false, "Whether the current draft has unsaved changes"),
    busy: elementProperty(t.boolean, () => false, "Whether a save is in progress"),
  },
  render: ({ label, dirty, busy }) => html`<p class="composition-draft-status" role="status" aria-label=${label}>
    <span aria-hidden="true">${busy ? "◷" : dirty ? "●" : "✓"}</span>
    ${busy ? "Saving changes…" : dirty ? "Unsaved changes" : "All changes saved"}
  </p>`,
});
