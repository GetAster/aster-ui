import { html, nothing } from "lit-html";
import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext } from "./bound-field.ts";

/**
 * A Boolean field as a checkbox. A null shows as mixed until set. Read-only
 * keeps it focusable, so its reason can be reached: it's `aria-readonly`
 * and a click doesn't change it.
 */
export class Check extends BoundField {
  override focus(options?: FocusOptions): void {
    this.querySelector("input")?.focus(options);
  }

  protected control(c: ControlContext): View {
    return html`<label class="aster-check">
      <input id=${c.id} type="checkbox" .checked=${c.value === true} .indeterminate=${c.value === null || c.value === undefined}
        aria-label=${this.labelled ? nothing : c.label}
        aria-readonly=${c.state.readOnly ? "true" : nothing}
        aria-required=${c.state.required ? "true" : nothing}
        @click=${(e: MouseEvent) => c.state.readOnly && e.preventDefault()}
        aria-invalid=${c.invalid ? "true" : nothing}
        aria-describedby=${c.describedBy ?? nothing}
        @change=${(e: Event) => this.write((e.target as HTMLInputElement).checked)}>
    </label>`;
  }
}

define("aster-check", Check);
