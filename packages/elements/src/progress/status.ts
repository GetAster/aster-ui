import { ProgressState, progressPolicy, type ProgressPolicy } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, define, type View } from "../base/element.ts";
import { progressPolicyOf } from "./policy.ts";

/** A reserved live-status line; request state and action availability are never delayed. */
export class ProgressStatus extends AsterElement {
  readonly #busy = this.prop(false);
  readonly #error = this.prop<string | undefined>(undefined);
  readonly #policy = this.prop<ProgressPolicy>({});
  readonly #pending = this.prop("Working…");
  readonly #complete = this.prop("Updated");
  readonly #reserve = this.prop(true);
  #state: ProgressState | undefined;
  get busy(): boolean { return this.#busy.value; }
  set busy(value: boolean) { this.#busy.value = value; }
  get error(): string | undefined { return this.#error.value; }
  set error(value: string | undefined) { this.#error.value = value; }
  get progressPolicy(): ProgressPolicy { return this.#policy.value; }
  set progressPolicy(value: ProgressPolicy) { progressPolicy(value); this.#policy.value = Object.freeze({ ...value }); }
  get pendingText(): string { return this.#pending.value; }
  set pendingText(value: string) { this.#pending.value = value; }
  get completeText(): string { return this.#complete.value; }
  set completeText(value: string) { this.#complete.value = value; }
  get reserveSpace(): boolean { return this.#reserve.value; }
  set reserveSpace(value: boolean) { this.#reserve.value = value; }

  override connectedCallback(): void {
    this.#state = new ProgressState(() => ({ busy: this.#busy.value, error: this.#error.value }),
      () => ({ ...progressPolicyOf(this), ...this.#policy.value }));
    this.onDisconnect(() => { this.#state?.dispose(); this.#state = undefined; });
    super.connectedCallback();
  }
  protected render(): View {
    const phase = this.#state?.phase.value ?? "idle";
    const text = phase === "working" ? this.#pending.value : phase === "complete" ? this.#complete.value : phase === "error" ? this.#error.value || "Could not complete." : "";
    return html`<span class="aster-progress-status" role="status" aria-atomic="true"
      ?data-reserve=${this.#reserve.value} data-phase=${phase}>${text ?? nothing}</span>`;
  }
}
define("aster-progress-status", ProgressStatus);
