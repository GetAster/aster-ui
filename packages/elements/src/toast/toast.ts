import { html, nothing } from "lit-html";
import { AsterElement, define, type View } from "../base/element.ts";

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

interface Shown {
  readonly message: string;
  readonly action?: ToastAction;
  readonly id: number;
}

/**
 * Toasts, one at a time, for results with no visible place of their own or
 * to offer Undo. A toast stays `duration` milliseconds, or `actionDuration`
 * with an action. Hovering over it or focusing inside it holds it; once
 * neither applies it stays a further 2 seconds.
 */
export class Toaster extends AsterElement {
  readonly #shown = this.prop<Shown | undefined>(undefined);
  readonly #visible = this.prop(false);
  readonly #duration = this.prop(1800);
  readonly #actionDuration = this.prop(6000);
  #hovered = false;
  #focused = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #ids = 0;

  /** How long a toast with no action stays, in milliseconds. Default 1800. */
  get duration(): number {
    return this.#duration.value;
  }
  set duration(v: number) {
    this.#duration.value = v;
  }
  /** How long a toast with an action stays, in milliseconds. Default 6000. */
  get actionDuration(): number {
    return this.#actionDuration.value;
  }
  set actionDuration(v: number) {
    this.#actionDuration.value = v;
  }

  show(message: string, action?: ToastAction): void {
    this.#shown.value = { message, id: ++this.#ids, ...(action ? { action } : {}) };
    this.#visible.value = true;
    // The old toast's button may still hold focus; the new one keeps waiting for it to leave.
    this.#focused = this.contains(document.activeElement);
    if (!this.#focused) this.#arm(action ? this.#actionDuration.peek() : this.#duration.peek());
  }

  dismiss(): void {
    clearTimeout(this.#timer);
    this.#hovered = this.#focused = false;
    this.#visible.value = false;
  }

  protected render(): View {
    const shown = this.#shown.value;
    return html`<div class="aster-toast" role="status" ?data-show=${this.#visible.value}
      @pointerenter=${() => this.#hold(true, undefined)}
      @pointerleave=${() => this.#hold(false, undefined)}
      @focusin=${() => this.#hold(undefined, true)}
      @focusout=${(e: FocusEvent) => !this.contains(e.relatedTarget as Node | null) && this.#hold(undefined, false)}>
      <i aria-hidden="true"></i><span>${shown?.message ?? ""}</span>
      ${shown?.action && this.#visible.value
        ? html`<button type="button" @click=${() => this.#act(shown.action!)}>${shown.action.label}</button>`
        : nothing}
    </div>`;
  }

  #act(action: ToastAction): void {
    this.dismiss();
    action.run();
  }

  /** Pointer and focus each hold the toast; the timer restarts once neither does. */
  #hold(hovered: boolean | undefined, focused: boolean | undefined): void {
    this.#hovered = hovered ?? this.#hovered;
    this.#focused = focused ?? this.#focused;
    if (this.#hovered || this.#focused) clearTimeout(this.#timer);
    else if (this.#visible.peek()) this.#arm(2000);
  }

  #arm(ms: number): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#hovered = this.#focused = false;
      this.#visible.value = false;
    }, ms);
  }
}

define("aster-toaster", Toaster);

let region: HTMLElement | undefined;

/** Tells screen readers about a background result, with no popup. */
export function announce(text: string): void {
  if (!region?.isConnected) {
    region = document.createElement("p");
    region.className = "aster-sr-only";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  region.textContent = "";
  const r = region;
  requestAnimationFrame(() => (r.textContent = text));
}
