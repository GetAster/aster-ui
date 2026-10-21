import { Command } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, define, type View } from "../base/element.ts";
import "../button/button.ts";

/** A labelled action group; every surface consumes the original guarded commands. */
export class CommandBar extends AsterElement {
  readonly #commands = this.prop<readonly Command[]>([]);
  readonly #label = this.prop("Actions");
  readonly #showErrors = this.prop(true);
  readonly #formatError = this.prop<((error: unknown, action: Command) => string) | undefined>(undefined);
  get commands(): readonly Command[] { return this.#commands.value; }
  set commands(value: readonly Command[]) { this.#commands.value = value; }
  get label(): string { return this.#label.value; }
  set label(value: string) { this.#label.value = value; }
  /** Disable when the application presents contextual failures at another surface. */
  get showErrors(): boolean { return this.#showErrors.value; }
  set showErrors(value: boolean) { this.#showErrors.value = value; }
  /** Translate errors into application-facing text without changing command state. */
  get formatError(): ((error: unknown, action: Command) => string) | undefined { return this.#formatError.value; }
  set formatError(value: ((error: unknown, action: Command) => string) | undefined) { this.#formatError.value = value; }

  protected render(): View {
    const commands = this.#commands.value;
    const failures = this.#showErrors.value ? commands.filter(action => action.error.value !== undefined) : [];
    return html`<div class="aster-command-bar" role="group" aria-label=${this.#label.value}>
      ${commands.map(action => html`<aster-button .label=${action.label} .busy=${action.busy.value}
        .reason=${action.reason.value} @click=${() => void action.execute().catch(() => {})}></aster-button>`)}
    </div>${failures.length ? html`<div class="aster-command-error" role="status">${failures.map(action => {
      const error = action.error.value;
      const message = this.#formatError.value?.(error, action) ?? (error instanceof Error ? error.message : String(error));
      return html`<p><strong>${action.label}</strong><span>${message}</span></p>`;
    })}</div>` : nothing}`;
  }
}
define("aster-command-bar", CommandBar);
