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
 *
 * `readOnly` keeps the switch focusable and announced but stops changes;
 * `disabled` takes it out of the tab order as well. `onLabel` and `offLabel`
 * reword the visible state ("Visible" / "Hidden").
 */
export class Switch extends AsterElement {
  readonly #binding = this.prop<SwitchBinding | undefined>(undefined);
  readonly #label = this.prop("");
  readonly #pending = this.prop<boolean | undefined>(undefined);
  readonly #error = this.prop<string | undefined>(undefined);
  readonly #disabled = this.prop(false);
  readonly #readOnly = this.prop(false);
  readonly #onLabel = this.prop<string | undefined>(undefined);
  readonly #offLabel = this.prop<string | undefined>(undefined);
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
  /** Removes the switch from the tab order and stops it toggling. Default `false`. */
  get disabled(): boolean {
    return this.#disabled.value;
  }
  set disabled(v: boolean) {
    this.#disabled.value = v;
  }
  /** Keeps the switch focusable but stops it toggling. Default `false`. */
  get readOnly(): boolean {
    return this.#readOnly.value;
  }
  set readOnly(v: boolean) {
    this.#readOnly.value = v;
  }
  /** Text shown while the switch is on. Default "On" when either label is given. */
  get onLabel(): string | undefined {
    return this.#onLabel.value;
  }
  set onLabel(v: string | undefined) {
    this.#onLabel.value = v;
  }
  /** Text shown while the switch is off. Default "Off" when either label is given. */
  get offLabel(): string | undefined {
    return this.#offLabel.value;
  }
  set offLabel(v: string | undefined) {
    this.#offLabel.value = v;
  }

  protected render(): View {
    const b = this.#binding.value;
    if (!b) return nothing;
    const stored = b.ctx.store.record(b.set, b.key).value?.entity[b.field];
    const pending = this.#pending.value;
    const on = pending ?? stored === true;
    const label = this.#label.value || b.ctx.schema.set(b.set).type.field(b.field)?.title || b.field;
    const error = this.#error.value;
    const labelled = this.#onLabel.value !== undefined || this.#offLabel.value !== undefined;
    const stateText = labelled ? (on ? this.#onLabel.value ?? "On" : this.#offLabel.value ?? "Off") : undefined;
    const stateId = stateText === undefined ? undefined : `${this.#id}-state`;
    const describedBy = [stateId ?? "", error ? `${this.#id}-error` : ""].filter(Boolean).join(" ") || undefined;
    return html`<div class="aster-switch-row" data-click
        ?data-disabled=${this.#disabled.value} ?data-readonly=${this.#readOnly.value}
        @click=${(e: MouseEvent) => this.#rowClick(e)}>
        <span id=${`${this.#id}-label`}>${label}</span>
        <span class="aster-switch-end">
          ${stateText === undefined ? nothing : html`<span class="aster-switch-state" id=${stateId}>${stateText}</span>`}
          <button type="button" class="aster-switch" role="switch" aria-checked=${on ? "true" : "false"}
            aria-labelledby=${`${this.#id}-label`} aria-busy=${pending === undefined ? "false" : "true"}
            aria-disabled=${this.#readOnly.value ? "true" : nothing}
            aria-readonly=${this.#readOnly.value ? "true" : nothing}
            aria-describedby=${describedBy ?? nothing}
            ?disabled=${this.#disabled.value}
            @click=${() => this.#toggle(!on)}></button>
        </span>
      </div>
      ${error ? html`<p class="aster-error" id=${`${this.#id}-error`} role="alert">${error}</p>` : nothing}`;
  }

  #rowClick(e: MouseEvent): void {
    if (this.#disabled.peek() || this.#readOnly.peek()) return;
    if ((e.target as Element).closest('[role="switch"]')) return;
    this.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
  }

  async #toggle(to: boolean): Promise<void> {
    const b = this.#binding.peek();
    if (!b || this.#disabled.peek() || this.#readOnly.peek() || this.#pending.peek() !== undefined) return;
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
