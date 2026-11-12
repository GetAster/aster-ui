import { html, nothing } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";

/**
 * A disclosure that sits in a line of text: a button with `aria-expanded`
 * and, after it in the same flow, the content it shows. It has no heading
 * and no region, so it fits inside a sentence where [[class:Section]], a
 * titled block, does not. The content stays in the DOM while hidden.
 */
export class Disclosure extends AsterElement {
  readonly #label = this.prop("");
  readonly #open = this.prop(false);
  readonly #body = this.prop<View>(nothing);
  readonly #id = uid("aster-disclosure");

  /** The button's text, such as "12 errors". */
  get label(): string { return this.#label.value; }
  set label(v: string) { this.#label.value = v; }
  /** Whether the content is shown. Default `false`. */
  get open(): boolean { return this.#open.value; }
  set open(v: boolean) {
    if (!v && this.querySelector(".aster-disclosure-body")?.contains(document.activeElement)) this.querySelector<HTMLElement>(".aster-disclosure-toggle")?.focus();
    this.#open.value = v;
  }
  /** The content shown while open. */
  get body(): View { return this.#body.value; }
  set body(v: View) { this.#body.value = v; }

  protected render(): View {
    const open = this.#open.value;
    this.toggleAttribute("data-open", open);
    return html`<button type="button" class="aster-disclosure-toggle" aria-expanded=${open ? "true" : "false"} aria-controls=${this.#id}
        @click=${() => { this.open = !this.#open.peek(); }}>${this.#label.value}<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5l-3 3"/></svg></button><span
        class="aster-disclosure-body" id=${this.#id} ?hidden=${!open}>${this.#body.value}</span>`;
  }
}

define("aster-disclosure", Disclosure);
