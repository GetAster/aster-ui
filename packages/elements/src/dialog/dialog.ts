import { html, nothing } from "lit-html";
import { AsterElement, define, type View } from "../base/element.ts";
import { morph } from "../motion.ts";

/**
 * A modal dialog over a native `<dialog>`: the rest of the page is inert,
 * focus goes in on open and returns to the opener on close, and Escape or
 * a click on the backdrop closes it. One dialog morphs between views
 * (`showView`) rather than stacking modals.
 */
export class Dialog extends AsterElement {
  readonly #content = this.prop<View>(nothing);
  readonly #label = this.prop<string | undefined>(undefined);
  #opener: HTMLElement | null = null;

  /** The dialog's contents; usually a template reading the current view. */
  get content(): View {
    return this.#content.value;
  }
  set content(v: View) {
    this.#content.value = v;
  }
  /** The id of the element that names the dialog. */
  get labelledBy(): string | undefined {
    return this.#label.value;
  }
  set labelledBy(v: string | undefined) {
    this.#label.value = v;
  }

  get open(): boolean {
    return this.#dialog()?.open ?? false;
  }

  /** Opens modally. `focus` is the element to focus inside; otherwise the first focusable. */
  show(opener: HTMLElement | null = document.activeElement as HTMLElement | null, focus?: () => HTMLElement | null): void {
    const dialog = this.#dialog();
    if (!dialog || dialog.open) return;
    this.#opener = opener;
    dialog.showModal();
    const target = focus?.();
    if (target) target.focus();
  }

  close(): void {
    const dialog = this.#dialog();
    if (!dialog?.open) return;
    dialog.close();
  }

  /** Changes view in place: the panel morphs, then the new content inks in. */
  showView(change: () => void): void {
    morph(change);
  }

  protected render(): View {
    return html`<dialog class="aster-dialog" aria-labelledby=${this.#label.value ?? nothing}
      @close=${() => this.#closed()}
      @click=${(e: MouseEvent) => e.target === e.currentTarget && this.close()}>
      <div class="aster-dialog-panel">${this.#content.value}</div>
    </dialog>`;
  }

  #closed(): void {
    const opener = this.#opener;
    this.#opener = null;
    if (opener?.isConnected) opener.focus();
    this.emit("close");
  }

  #dialog(): HTMLDialogElement | null {
    return this.querySelector("dialog");
  }
}

define("aster-dialog", Dialog);
