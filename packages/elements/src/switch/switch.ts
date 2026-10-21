import type { DataContext, KeyText } from "@getaster/data";
import { ODataError } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";

export interface SwitchBinding {
  readonly ctx: DataContext;
  readonly set: string;
  readonly key: KeyText;
  readonly field: string;
}

/**
 * A row with a switch, bound to one Boolean field of a stored record. The
 * whole row toggles it. A toggle saves straight away: the switch shows the
 * new state while the save runs, and if the save fails it goes back and the
 * error shows under the row. The label is the field's title from metadata.
 */
export class Switch extends AsterElement {
  readonly #binding = this.prop<SwitchBinding | undefined>(undefined);
  readonly #label = this.prop("");
  readonly #pending = this.prop<boolean | undefined>(undefined);
  readonly #error = this.prop<string | undefined>(undefined);
  readonly #id = uid("aster-switch");

  get binding(): SwitchBinding | undefined {
    return this.#binding.value;
  }
  set binding(v: SwitchBinding | undefined) {
    this.#binding.value = v;
  }
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }

  protected render(): View {
    const b = this.#binding.value;
    if (!b) return nothing;
    const stored = b.ctx.store.record(b.set, b.key).value?.entity[b.field];
    const pending = this.#pending.value;
    const on = pending ?? stored === true;
    const label = this.#label.value || b.ctx.schema.set(b.set).type.field(b.field)?.title || b.field;
    const error = this.#error.value;
    return html`<div class="aster-switch-row" data-click @click=${(e: MouseEvent) => this.#rowClick(e)}>
        <span id=${`${this.#id}-label`}>${label}</span>
        <button type="button" class="aster-switch" role="switch" aria-checked=${on ? "true" : "false"}
          aria-labelledby=${`${this.#id}-label`} aria-busy=${pending === undefined ? "false" : "true"}
          aria-describedby=${error ? `${this.#id}-error` : nothing}
          @click=${() => this.#toggle(!on)}></button>
      </div>
      ${error ? html`<p class="aster-error" id=${`${this.#id}-error`} role="alert">${error}</p>` : nothing}`;
  }

  #rowClick(e: MouseEvent): void {
    if ((e.target as Element).closest('[role="switch"]')) return;
    this.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
  }

  async #toggle(to: boolean): Promise<void> {
    const b = this.#binding.peek();
    if (!b || this.#pending.peek() !== undefined) return;
    this.#pending.value = to;
    this.#error.value = undefined;
    try {
      await b.ctx.update(b.set, b.key, { [b.field]: to }, this);
    } catch (e) {
      const what = to ? "turn this on" : "turn this off";
      this.#error.value = `Couldn’t ${what}: ${e instanceof ODataError ? e.message : String(e)} It’s back as it was.`;
    } finally {
      this.#pending.value = undefined;
    }
  }
}

define("aster-switch", Switch);
