import { html, nothing } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";
import { morph } from "../motion.ts";
import { dialogCloseShown, dialogHeaderShown } from "./config.ts";

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";

/**
 * A dialog over a native `<dialog>`: modal by default, so the rest of the
 * page is inert and focus stays inside; non-modal with `modal = false`, where
 * the page stays usable. One dialog morphs between views (`showView`)
 * rather than stacking dialogs. Escape and a backdrop press dismiss it unless
 * the host turns those off.
 */
export class Dialog extends AsterElement {
  readonly #content = this.prop<View>(nothing);
  readonly #label = this.prop<string | undefined>(undefined);
  readonly #title = this.prop("");
  readonly #header = this.prop<boolean | undefined>(undefined);
  readonly #footer = this.prop<View>(nothing);
  readonly #showClose = this.prop<boolean | undefined>(undefined);
  readonly #modal = this.prop(true);
  readonly #dismissOnEscape = this.prop(true);
  readonly #dismissOnBackdrop = this.prop(true);
  readonly #initialFocus = this.prop<"first" | "dialog" | "none" | (() => HTMLElement | null) | undefined>(undefined);
  readonly #id = uid("aster-dialog");
  #opener: HTMLElement | null = null;

  /** The dialog's contents; usually a template reading the current view. */
  get content(): View {
    return this.#content.value;
  }
  set content(v: View) {
    this.#content.value = v;
  }
  /** The id of the element that names the dialog. It wins over `title`. */
  get labelledBy(): string | undefined {
    return this.#label.value;
  }
  set labelledBy(v: string | undefined) {
    this.#label.value = v;
  }

  /** The dialog's title, as text. Setting it shows a header unless `header` is false. Default `""`. */
  override get title(): string {
    return this.#title.value;
  }
  override set title(v: string) {
    if (typeof v !== "string") throw new TypeError("title must be a string");
    this.#title.value = v;
  }

  /** Whether the header bar is drawn. Default: shown when `title` is set. */
  get header(): boolean | undefined {
    return this.#header.value;
  }
  set header(v: boolean | undefined) {
    if (v !== undefined && typeof v !== "boolean") throw new TypeError("header must be a boolean");
    this.#header.value = v;
  }

  /** The footer contents, shown below the content when set. */
  get footer(): View {
    return this.#footer.value;
  }
  set footer(v: View) {
    this.#footer.value = v;
  }

  /** Whether the header carries a Close control. Default `false`. */
  get showCloseButton(): boolean | undefined {
    return this.#showClose.value;
  }
  set showCloseButton(v: boolean | undefined) {
    if (v !== undefined && typeof v !== "boolean") throw new TypeError("showCloseButton must be a boolean");
    this.#showClose.value = v;
  }

  /** Whether the dialog is modal. Default `true`; non-modal leaves the page usable. */
  get modal(): boolean {
    return this.#modal.value;
  }
  set modal(v: boolean) {
    if (typeof v !== "boolean") throw new TypeError("modal must be a boolean");
    this.#modal.value = v;
  }

  /** Whether Escape closes the dialog. Default `true`. */
  get dismissOnEscape(): boolean {
    return this.#dismissOnEscape.value;
  }
  set dismissOnEscape(v: boolean) {
    this.#dismissOnEscape.value = v !== false;
  }

  /** Whether a press on the backdrop closes a modal dialog. Default `true`. */
  get dismissOnBackdrop(): boolean {
    return this.#dismissOnBackdrop.value;
  }
  set dismissOnBackdrop(v: boolean) {
    this.#dismissOnBackdrop.value = v !== false;
  }

  /**
   * Where focus goes on open: the first focusable element (default), the
   * dialog itself, nowhere, or a function returning the element to focus.
   */
  get initialFocus(): "first" | "dialog" | "none" | (() => HTMLElement | null) | undefined {
    return this.#initialFocus.value;
  }
  set initialFocus(v: "first" | "dialog" | "none" | (() => HTMLElement | null) | undefined) {
    if (v !== undefined && v !== "first" && v !== "dialog" && v !== "none" && typeof v !== "function") {
      throw new TypeError('initialFocus must be "first", "dialog", "none" or a function');
    }
    this.#initialFocus.value = v;
  }

  get open(): boolean {
    return this.#dialog()?.open ?? false;
  }

  /** Opens the dialog. `focus` is still accepted and wins over `initialFocus`. */
  show(opener: HTMLElement | null = document.activeElement as HTMLElement | null, focus?: () => HTMLElement | null): void {
    const dialog = this.#dialog();
    if (!dialog || dialog.open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.#opener = opener;
    if (this.#modal.value) dialog.showModal();
    else dialog.show();
    this.#focusInitial(focus?.(), previous);
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
    const title = this.#title.value;
    const header = dialogHeaderShown(title, this.#header.value);
    const close = dialogCloseShown(header, this.#showClose.value);
    const titleId = `${this.#id}-title`;
    const labelledBy = this.#label.value ?? (header && title ? titleId : undefined);
    return html`<dialog class="aster-dialog" aria-labelledby=${labelledBy ?? nothing}
      aria-label=${labelledBy ? nothing : title || nothing} tabindex="-1"
      @close=${() => this.#closed()}
      @cancel=${(e: Event) => {
        e.preventDefault();
        if (this.#dismissOnEscape.peek()) this.close();
      }}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        if (this.#dismissOnEscape.value) this.close();
      }}
      @click=${(e: MouseEvent) => e.target === e.currentTarget && this.#dismissOnBackdrop.value && this.close()}>
      <div class="aster-dialog-panel">
        ${header ? html`<div class="aster-dialog-head">
          ${title ? html`<h2 class="aster-dialog-title" id=${titleId}>${title}</h2>` : nothing}
          ${close ? html`<button type="button" class="aster-dialog-close" aria-label="Close"
            @click=${() => this.close()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>` : nothing}
        </div>` : nothing}
        ${this.#content.value}
        ${this.#footer.value === nothing ? nothing : html`<div class="aster-dialog-footer">${this.#footer.value}</div>`}
      </div>
    </dialog>`;
  }

  /** An explicit function wins, then a configured policy; otherwise the native focus steps stand. */
  #focusInitial(explicit: HTMLElement | null | undefined, previous: HTMLElement | null): void {
    const dialog = this.#dialog();
    if (!dialog || (!explicit && this.#initialFocus.peek() === undefined)) return;
    const target = explicit ?? this.#policyTarget(dialog, previous);
    target?.focus();
  }

  #policyTarget(dialog: HTMLDialogElement, previous: HTMLElement | null): HTMLElement | undefined {
    const mode = this.#initialFocus.peek();
    if (typeof mode === "function") return mode() ?? undefined;
    switch (mode) {
      case "none":
        // A modal dialog must contain focus; otherwise restore what was focused before show().
        return this.#modal.peek() ? dialog : (previous?.isConnected && !dialog.contains(previous) ? previous : undefined);
      case "dialog":
        return dialog;
      case "first":
      case undefined:
        return dialog.querySelector<HTMLElement>("[autofocus]") ?? [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].find(isFocusable) ?? dialog;
    }
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

function isFocusable(element: HTMLElement): boolean {
  return element.tabIndex >= 0 && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
}

define("aster-dialog", Dialog);
