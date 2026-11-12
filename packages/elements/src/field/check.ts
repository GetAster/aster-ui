import { html, nothing, type TemplateResult } from "lit-html";
import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext, type LabelPosition } from "./bound-field.ts";

/** Where a check's shown label sits: above, as on other fields, or beside the box. */
export type CheckLabelPosition = LabelPosition;

/**
 * A Boolean field as a checkbox. A null shows as mixed until set. Read-only
 * keeps it focusable, so its reason can be reached: it's `aria-readonly`
 * and a click doesn't change it. With `labelled`, `labelPosition` puts the
 * label above the box or beside it, inside the checkbox's own label.
 */
export class Check extends BoundField {
  /** Beside the box, the label is part of the checkbox's own label. */
  protected override labelPositions(): readonly LabelPosition[] { return ["above", "start", "end"]; }

  protected override labelBeside(): boolean { return this.labelPosition !== "above"; }

  override focus(options?: FocusOptions): void {
    this.querySelector("input")?.focus(options);
  }

  protected control(c: ControlContext): View {
    const side = this.labelled ? this.labelPosition : "above";
    const text: TemplateResult | typeof nothing = side === "above" ? nothing : html`<span class="aster-check-label">${c.label}</span>`;
    return html`<label class="aster-check">${side === "start" ? text : nothing}
      <input id=${c.id} type="checkbox" .checked=${c.value === true} .indeterminate=${c.value === null || c.value === undefined}
        aria-label=${this.labelled ? nothing : c.label}
        aria-readonly=${c.state.readOnly ? "true" : nothing}
        aria-required=${c.state.required ? "true" : nothing}
        ?disabled=${!c.state.enabled}
        @click=${(e: MouseEvent) => c.state.readOnly && e.preventDefault()}
        aria-invalid=${c.invalid ? "true" : nothing}
        aria-describedby=${c.describedBy ?? nothing}
        @change=${(e: Event) => this.write((e.target as HTMLInputElement).checked)}>${side === "end" ? text : nothing}
    </label>`;
  }
}

define("aster-check", Check);
