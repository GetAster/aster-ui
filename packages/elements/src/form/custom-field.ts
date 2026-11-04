import type { Value } from "@getaster/data";
import { nothing } from "lit-html";
import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext } from "../field/bound-field.ts";
import type { FormControlContext, FormControlRender } from "./controls.ts";

/**
 * A field whose editor is a renderer supplied by the page. The frame, label,
 * hint, error and state handling stay [[class:BoundField]]'s; the renderer
 * gets the control context and a write that respects read-only and disabled.
 * Internal: [[object:FormField.control]] is the public surface.
 */
class CustomField extends BoundField {
  readonly #renderControl = this.prop<FormControlRender | undefined>(undefined);

  get renderControl(): FormControlRender | undefined {
    return this.#renderControl.value;
  }
  set renderControl(v: FormControlRender | undefined) {
    this.#renderControl.value = v;
  }

  protected control(c: ControlContext): View {
    const render = this.#renderControl.value;
    return render ? render({ ...c, write: (value: Value) => this.write(value) }) : nothing;
  }
}

define("aster-custom-field", CustomField);
