import { html, nothing } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";
import { openWhen } from "../overlay/anchor.ts";
import { windowBar } from "./chrome.ts";
import {
  centerWindow,
  clampWindow,
  parseWindowPlacement,
  resolveWindowChrome,
  type ResolvedWindowChrome,
  type WindowBounds,
  type WindowChrome,
  type WindowLimits,
  type WindowPlacement,
  type WindowState,
} from "./config.ts";

const STEP = 16;
const BIG_STEP = 64;
const MARGIN = 8;

export type { WindowBounds, WindowChrome, WindowPlacement, WindowState } from "./config.ts";

/** Window chrome and content; content ownership stays with the host page. */
export class Window extends AsterElement {
  readonly #content = this.prop<View>(nothing);
  readonly #heading = this.prop("");
  readonly #open = this.prop(false);
  readonly #state = this.prop<WindowState>("normal");
  readonly #managed = this.prop(false);
  readonly #active = this.prop(false);
  readonly #preserve = this.prop(false);
  readonly #closing = this.prop(false);
  readonly #chrome = this.prop<WindowChrome>({});
  readonly #footer = this.prop<View>(nothing);
  readonly #status = this.prop<View>(nothing);
  readonly #initial = this.prop<WindowPlacement | undefined>(undefined);
  readonly #modal = this.prop(false);
  readonly #dismissOnEscape = this.prop(true);
  readonly #keepInParentRect = this.prop(false);
  readonly #autoCenter = this.prop(false);
  readonly #folded = this.prop(false);
  readonly #id = uid("aster-window");
  #opener: HTMLElement | null = null;
  #at: { x: number; y: number } | undefined;
  #bounds: WindowBounds | undefined;
  #restoreMaximized = false;
  #mounted = false;
  #resize: ResizeObserver | undefined;
  #observed: HTMLElement | null = null;
  #focus: HTMLElement | null = null;
  #closeTask: Promise<boolean> | undefined;
  #modalQueued = false;
  #hostCloses = 0;
  /** Modality as captured when the window opened; changing `modal` applies on the next open. */
  #shownModal = false;
  #generation = 0;
  #beforeClose: (() => boolean | Promise<boolean>) | undefined;
  #dragEnd: (() => void) | undefined;

  get heading(): string { return this.#heading.value; }
  set heading(v: string) { this.#heading.value = v; }
  get content(): View { return this.#content.value; }
  set content(v: View) { this.#content.value = v; }
  get open(): boolean { return this.#open.value; }
  get state(): WindowState { return this.#state.value; }
  get active(): boolean { return this.#active.value; }
  get managed(): boolean { return this.#managed.value; }
  set managed(v: boolean) { this.#managed.value = v; }
  get preserveContent(): boolean { return this.#preserve.value; }
  set preserveContent(v: boolean) { this.#preserve.value = v; }
  get closing(): boolean { return this.#closing.value; }
  get beforeClose(): (() => boolean | Promise<boolean>) | undefined { return this.#beforeClose; }
  set beforeClose(v: (() => boolean | Promise<boolean>) | undefined) { this.#beforeClose = v; }

  /** Which parts of the window chrome it draws, as [[object:WindowChrome]]. Default `{}`. */
  get chrome(): WindowChrome { return this.#chrome.value; }
  set chrome(v: WindowChrome) { this.#chrome.value = { ...(v ?? {}) }; }

  /** Sugar for `chrome.header`. Default `true`. */
  get showHeader(): boolean { return this.#resolved().header; }
  set showHeader(v: boolean) { this.#setChrome("header", v); }

  /** Sugar for `chrome.title`. Default `true`; a hidden title still names the window. */
  get showTitle(): boolean { return this.#resolved().title; }
  set showTitle(v: boolean) { this.#setChrome("title", v); }

  /** Sugar for `chrome.close`. Default `true`. */
  get showCloseButton(): boolean { return this.#resolved().close; }
  set showCloseButton(v: boolean) { this.#setChrome("close", v); }

  /** Sugar for `chrome.minimize`. Default: shown for managed windows. */
  get showMinimizeButton(): boolean { return this.#resolved().minimize; }
  set showMinimizeButton(v: boolean) { this.#setChrome("minimize", v); }

  /** Sugar for `chrome.maximize`. Default: shown for managed windows. */
  get showMaximizeButton(): boolean { return this.#resolved().maximize; }
  set showMaximizeButton(v: boolean) { this.#setChrome("maximize", v); }

  /** Sugar for `chrome.resizer`. Default `true`. */
  get showResizer(): boolean { return this.#resolved().resizer; }
  set showResizer(v: boolean) { this.#setChrome("resizer", v); }

  /** Sugar for `chrome.fold`. Default `false`. */
  get showFoldButton(): boolean { return this.#resolved().fold; }
  set showFoldButton(v: boolean) { this.#setChrome("fold", v); }

  /**
   * Whether the window is folded to its title bar. Its content stays mounted
   * but hidden, and it can't be resized. It shows only while the window is
   * normal and has a header. Default `false`.
   */
  get folded(): boolean { return this.#folded.value; }
  set folded(v: boolean) {
    if (typeof v !== "boolean") throw new TypeError("folded must be a boolean");
    if (v === this.#folded.peek()) return;
    if (v) {
      this.#capture();
      const panel = this.#panel();
      const bar = panel?.querySelector(".aster-window-bar");
      // Focus in the content would be hidden with it.
      if (panel?.contains(document.activeElement) && !bar?.contains(document.activeElement)) {
        (panel.querySelector<HTMLElement>(".aster-window-fold") ?? panel).focus({ preventScroll: true });
      }
    }
    this.#folded.value = v;
    if (this.#open.peek()) this.emit("placementchange", this.placement());
  }

  /** Sugar for `chrome.footer`. Default `false`. */
  get showFooter(): boolean { return this.#resolved().footer; }
  set showFooter(v: boolean) { this.#setChrome("footer", v); }

  /** Sugar for `chrome.statusBar`. Default `false`. */
  get showStatusBar(): boolean { return this.#resolved().statusBar; }
  set showStatusBar(v: boolean) { this.#setChrome("statusBar", v); }

  /** The footer's contents. Setting it also sets `chrome.footer`; `nothing` clears the flag. */
  get footer(): View { return this.#footer.value; }
  set footer(v: View) {
    this.#footer.value = v;
    this.#setChrome("footer", v !== nothing);
  }

  /** The status bar's contents. Setting it also sets `chrome.statusBar`; `nothing` clears the flag. */
  get status(): View { return this.#status.value; }
  set status(v: View) {
    this.#status.value = v;
    this.#setChrome("statusBar", v !== nothing);
  }

  /** Geometry used the first time the window opens, before any placement is captured. */
  get initialPlacement(): WindowPlacement | undefined { return this.#initial.value; }
  set initialPlacement(v: WindowPlacement | undefined) {
    this.#initial.value = v === undefined ? undefined : parseWindowPlacement(v);
  }

  /** Whether the window makes the rest of the page inert while open. Default `false`. */
  get modal(): boolean { return this.#modal.value; }
  set modal(v: boolean) { this.#modal.value = v === true; }

  /** Whether Escape inside the window closes it. Default `true`. */
  get dismissOnEscape(): boolean { return this.#dismissOnEscape.value; }
  set dismissOnEscape(v: boolean) { this.#dismissOnEscape.value = v !== false; }

  /** Whether dragging keeps the window inside its parent element. Default `false`. */
  get keepInParentRect(): boolean { return this.#keepInParentRect.value; }
  set keepInParentRect(v: boolean) { this.#keepInParentRect.value = v === true; }

  /** Whether the window centres itself the first time it opens. Default `false`. */
  get autoCenter(): boolean { return this.#autoCenter.value; }
  set autoCenter(v: boolean) { this.#autoCenter.value = v === true; }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resize = new ResizeObserver(() => {
      if (!this.#open.peek() || this.#state.peek() !== "normal") return;
      this.#recover();
      this.#capture();
      this.emit("placementchange", this.placement());
    });
    this.#observe();
    this.listen(window, "resize", () => this.#recover());
    this.onDisconnect(() => {
      this.#resize?.disconnect();
      this.#observed = null;
      this.#generation++;
      this.#closeTask = undefined;
      this.#closing.value = false;
      this.#dragEnd?.();
    });
  }

  show(opener: HTMLElement | null = document.activeElement as HTMLElement | null): void {
    if (!this.#open.peek()) {
      if (!this.#mounted) this.#adoptInitial();
      this.#opener = opener;
      this.#mounted = true;
      this.#shownModal = this.#modal.peek();
      this.#open.value = true;
    }
    if (this.#state.peek() === "minimized") this.#state.value = this.#restoreMaximized ? "maximized" : "normal";
    requestAnimationFrame(() => {
      if (!this.isConnected || !this.#open.peek()) return;
      const panel = this.#panel();
      if (!panel) return;
      if (this.#state.peek() === "normal") {
        this.#place(this.#at ?? (this.#autoCenter.peek() ? centerWindow(sizeOf(panel), this.#limits()) : beside(opener, panel)));
      }
      this.#applySize();
      this.activate();
      this.emit("statechange", this.#state.peek());
    });
  }

  /** Activates chrome without reparenting the content or recreating its models. */
  activate(focus = true): void {
    const panel = this.#panel();
    const modalHost = this.#modalHost();
    const blocked = document.querySelector("dialog:modal");
    if (!panel || !this.#open.peek() || this.#state.peek() === "minimized" || (blocked && blocked !== modalHost)) return;
    if (!this.#active.peek()) {
      const previous = document.activeElement;
      this.#active.value = true;
      if (!this.#shownModal) {
        // Top-layer order is insertion order; z-index cannot raise a popover.
        if (panel.matches(":popover-open")) panel.hidePopover();
        panel.showPopover();
      }
      if (!focus && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      this.emit("activate");
    }
    if (focus) (this.#focus?.isConnected && panel.contains(this.#focus) ? this.#focus : panel).focus({ preventScroll: true });
  }

  deactivate(): void { this.#active.value = false; }

  close(): Promise<boolean> {
    if (this.#closeTask) return this.#closeTask;
    if (!this.#open.peek()) return Promise.resolve(true);
    if (!this.#beforeClose) {
      this.#finishClose();
      return Promise.resolve(true);
    }
    const generation = this.#generation;
    const guard = this.#beforeClose;
    this.#closing.value = true;
    this.#closeTask = Promise.resolve().then(() => guard()).then(allowed => {
      if (!allowed || generation !== this.#generation || !this.isConnected) return false;
      this.#finishClose();
      return true;
    }).catch((error: unknown) => {
      if (generation === this.#generation) this.emit("closeerror", error);
      return false;
    }).finally(() => {
      if (generation === this.#generation) {
        this.#closing.value = false;
        this.#closeTask = undefined;
      }
    });
    return this.#closeTask;
  }

  toggle(opener?: HTMLElement | null): void {
    if (this.#open.peek() && this.#state.peek() !== "minimized") void this.close();
    else this.show(opener);
  }

  minimize(): void {
    if (!this.#open.peek() || this.#state.peek() === "minimized") return;
    this.#capture();
    this.#restoreMaximized = this.#state.peek() === "maximized";
    this.#rememberFocus();
    const returnFocus = this.#active.peek() || this.#panel()?.contains(document.activeElement);
    this.#state.value = "minimized";
    this.#active.value = false;
    this.#closeHost();
    if (returnFocus) this.#returnFocus();
    this.#changed();
  }

  maximize(): void {
    if (!this.#open.peek()) return;
    this.#capture();
    this.#state.value = "maximized";
    this.#changed();
  }

  restore(): void {
    if (!this.#open.peek()) return;
    const minimized = this.#state.peek() === "minimized";
    this.#state.value = minimized && this.#restoreMaximized ? "maximized" : "normal";
    this.#changed();
    requestAnimationFrame(() => { this.#applySize(); this.activate(); });
  }

  placement(): WindowPlacement {
    this.#capture();
    return { state: this.#state.peek(), ...(this.#bounds ? { bounds: { ...this.#bounds } } : {}), restoreMaximized: this.#restoreMaximized, folded: this.#folded.peek() };
  }

  /** Invalid persisted data is rejected atomically. CSS limits size to the viewport. */
  setPlacement(value: WindowPlacement): void {
    this.#adopt(parseWindowPlacement(value));
    requestAnimationFrame(() => this.#applySize());
  }

  protected override updated(): void {
    this.#observe();
    this.#syncModal();
    if (this.#open.peek() && this.#state.peek() !== "minimized") this.#applySize();
  }

  protected render(): View {
    const open = this.#open.value;
    const state = this.#state.value;
    const preserve = this.#preserve.value;
    if (!open && !(preserve && this.#mounted)) return nothing;
    const heading = `${this.#id}-heading`;
    const title = this.#heading.value;
    const chrome = this.#resolved();
    const modal = this.#shownModal;
    const titleView = chrome.title ? title : html`<span class="aster-sr-only">${title}</span>`;
    const folded = this.#folded.value;
    const foldable = chrome.header && state === "normal";
    const panel = html`<div class="aster-window" popover=${modal ? nothing : "manual"} role="dialog" aria-modal=${modal ? "true" : "false"}
      aria-labelledby=${chrome.header ? heading : nothing} aria-label=${chrome.header ? nothing : title || nothing}
      data-state=${state} data-active=${String(this.#active.value)} aria-busy=${String(this.#closing.value)}
      data-resizer=${chrome.resizer ? nothing : "false"} ?data-folded=${folded && foldable}
      tabindex="-1" ${modal ? nothing : openWhen(open && state !== "minimized")}
      @pointerdown=${() => this.activate(false)} @focusin=${() => { this.#rememberFocus(); this.activate(false); }}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        if (this.#dismissOnEscape.value) void this.close();
      }}>
      ${chrome.header ? windowBar(heading, titleView, html`<button type="button" class="aster-window-move" aria-label=${`Move ${title}`}
          ?disabled=${state !== "normal"} aria-describedby=${`${this.#id}-move-help`}
          @keydown=${(e: KeyboardEvent) => this.#geometryKey(e, false)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2"/></svg>
        </button>
        <span id=${`${this.#id}-move-help`} hidden>Arrow keys move the window; with Shift, further.</span>
        ${chrome.resizer ? html`<button type="button" aria-label=${`Resize ${title}`} ?disabled=${state !== "normal" || folded}
          aria-describedby=${`${this.#id}-resize-help`} @keydown=${(e: KeyboardEvent) => this.#geometryKey(e, true)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13 13 3M7 3h6v6M3 7v6h6"/></svg>
        </button>
        <span id=${`${this.#id}-resize-help`} hidden>Arrow keys resize the window; with Shift, further.</span>` : nothing}
        ${chrome.fold ? html`<button type="button" class="aster-window-fold" ?disabled=${!foldable}
          aria-expanded=${folded ? "false" : "true"} aria-controls=${`${this.#id}-body`}
          aria-label=${`${folded ? "Expand" : "Collapse"} ${title}`} @click=${() => { this.folded = !this.#folded.peek(); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg></button>` : nothing}
        ${chrome.minimize ? html`<button type="button" aria-label=${`Minimize ${title}`} @click=${() => this.minimize()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12h10"/></svg></button>` : nothing}
        ${chrome.maximize ? html`<button type="button" aria-label=${`${state === "maximized" ? "Restore" : "Maximize"} ${title}`}
            @click=${() => state === "maximized" ? this.restore() : this.maximize()}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10v10H3zM3 6h10"/></svg></button>` : nothing}
        ${chrome.close ? html`<button type="button" class="aster-window-close" aria-label=${`Close ${title}`} ?disabled=${this.#closing.value} @click=${() => void this.close()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>` : nothing}`, (event) => this.#drag(event)) : nothing}
      <div class="aster-window-body" id=${`${this.#id}-body`}>${this.#content.value}</div>
      ${chrome.footer ? html`<div class="aster-window-footer">${this.#footer.value}</div>` : nothing}
      ${chrome.statusBar ? html`<div class="aster-window-status" role="status">${this.#status.value}</div>` : nothing}
    </div>`;
    // The wrapper is always rendered so a modality change between openings can
    // move the live panel instead of recreating its content and drafts.
    return html`<dialog class="aster-window-modal"
      @cancel=${(e: Event) => { e.preventDefault(); if (this.#dismissOnEscape.peek()) void this.close(); }}
      @close=${() => {
        if (this.#hostCloses > 0) {
          this.#hostCloses--;
          return;
        }
        if (this.#open.peek() && this.#state.peek() !== "minimized") this.#finishClose();
      }}></dialog>${panel}`;
  }

  #finishClose(): void {
    const returnFocus = this.#active.peek() || this.#panel()?.contains(document.activeElement);
    this.#rememberFocus();
    this.#capture();
    this.#open.value = false;
    this.#active.value = false;
    this.#closeHost();
    if (returnFocus) this.#returnFocus();
    this.emit("close");
  }

  /** Closes the wrapper without treating its queued `close` event as external. */
  #closeHost(): void {
    // Only a modal window has a wrapper that closes it; the always-present
    // dialog stays empty and closed for a non-modal window.
    const host = this.#shownModal ? this.#modalHost() : null;
    if (host) {
      // A `<form method="dialog">` close leaves the host closed; its panel is already hidden with it.
      if (host.open) {
        this.#hostCloses++;
        host.close();
      }
      return;
    }
    this.#panel()?.hidePopover();
  }

  #rememberFocus(): void {
    if (document.activeElement instanceof HTMLElement && this.#panel()?.contains(document.activeElement)) this.#focus = document.activeElement;
  }

  #returnFocus(): void {
    if (this.#opener?.isConnected) this.#opener.focus({ preventScroll: true });
  }

  #changed(): void {
    this.emit("statechange", this.#state.peek());
    this.emit("placementchange", this.placement());
  }

  #geometryKey(e: KeyboardEvent, resize: boolean): void {
    if (this.#state.peek() !== "normal" || (resize && this.#folded.peek())) return;
    const step = e.shiftKey ? BIG_STEP : STEP;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const by = d[e.key];
    const panel = this.#panel();
    if (!by || !panel) return;
    e.preventDefault();
    if (resize) {
      const r = panel.getBoundingClientRect();
      panel.style.width = `${Math.max(240, r.width + by[0])}px`;
      panel.style.height = `${Math.max(160, r.height + by[1])}px`;
      this.#recover();
      this.#capture();
    } else if (this.#at) this.#place({ x: this.#at.x + by[0], y: this.#at.y + by[1] });
    this.emit("placementchange", this.placement());
  }

  #drag(e: PointerEvent): void {
    if (e.button !== 0 || this.#state.peek() !== "normal" || (e.target as Element).closest("button") || !this.#at) return;
    const bar = e.currentTarget as HTMLElement;
    this.#dragEnd?.();
    const start = { x: e.clientX - this.#at.x, y: e.clientY - this.#at.y };
    bar.setPointerCapture(e.pointerId);
    e.preventDefault();
    const move = (m: PointerEvent) => this.#place({ x: m.clientX - start.x, y: m.clientY - start.y });
    const end = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", end);
      bar.removeEventListener("pointercancel", end);
      this.#dragEnd = undefined;
      this.emit("placementchange", this.placement());
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
    this.#dragEnd = end;
  }

  #capture(): void {
    const panel = this.#panel();
    if (!panel || !this.#shown(panel) || this.#state.peek() !== "normal" || panel.dataset.state !== "normal") return;
    const r = panel.getBoundingClientRect();
    // Folded, the panel is only its title bar; keep the height it unfolds to.
    if (panel.hasAttribute("data-folded")) {
      if (this.#bounds) this.#bounds = { ...this.#bounds, x: r.x, y: r.y };
      return;
    }
    this.#bounds = { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  #applySize(): void {
    const panel = this.#panel();
    if (!panel) return;
    const limits = this.#limits();
    // CSS owns the window's min/max geometry; the panel reads these intent variables.
    if (this.#keepInParentRect.peek()) {
      panel.style.setProperty("--window-cap-width", `${limits.right - limits.left}px`);
      panel.style.setProperty("--window-cap-height", `${limits.bottom - limits.top}px`);
    } else {
      panel.style.removeProperty("--window-cap-width");
      panel.style.removeProperty("--window-cap-height");
    }
    if (this.#bounds) {
      panel.style.width = `${this.#bounds.width}px`;
      panel.style.height = `${this.#bounds.height}px`;
    }
    this.#recover();
  }

  #recover(): void {
    if (this.#state.peek() === "normal" && this.#at && this.#shown(this.#panel())) this.#place(this.#at);
  }

  #observe(): void {
    const panel = this.#panel();
    if (panel === this.#observed || !this.#resize) return;
    this.#resize.disconnect();
    this.#observed = panel;
    if (panel) this.#resize.observe(panel);
  }

  #place(to: { x: number; y: number }): void {
    const panel = this.#panel();
    if (!panel) return;
    const at = clampWindow(to, sizeOf(panel), this.#limits());
    this.#at = at;
    panel.style.setProperty("--window-x", `${at.x}px`);
    panel.style.setProperty("--window-y", `${at.y}px`);
  }

  /** The nearest viewport edge inside the parent, when `keepInParentRect` is on. */
  #limits(): WindowLimits {
    const viewport: WindowLimits = { left: MARGIN, top: MARGIN, right: innerWidth - MARGIN, bottom: innerHeight - MARGIN };
    if (!this.#keepInParentRect.peek()) return viewport;
    const r = this.parentElement?.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return viewport;
    return { left: Math.max(viewport.left, r.left), top: Math.max(viewport.top, r.top), right: Math.min(viewport.right, r.right), bottom: Math.min(viewport.bottom, r.bottom) };
  }

  #shown(panel: HTMLElement | null): panel is HTMLElement {
    if (!panel) return false;
    if (this.#shownModal) return this.#modalHost()?.open === true;
    return panel.matches(":popover-open");
  }

  #resolved(): ResolvedWindowChrome {
    return resolveWindowChrome(this.#chrome.value, this.#managed.value);
  }

  #setChrome(key: keyof WindowChrome, value: boolean): void {
    if (typeof value !== "boolean") throw new TypeError(`${key} must be a boolean`);
    this.#chrome.value = { ...this.#chrome.peek(), [key]: value };
  }

  #adopt(placement: WindowPlacement): void {
    this.#bounds = placement.bounds ? { ...placement.bounds } : undefined;
    this.#at = placement.bounds ? { x: placement.bounds.x, y: placement.bounds.y } : undefined;
    this.#restoreMaximized = placement.restoreMaximized === true;
    this.#folded.value = placement.folded === true;
    this.#state.value = placement.state;
  }

  /** A declarative first placement applies only until any placement has been captured. */
  #adoptInitial(): void {
    const initial = this.#initial.peek();
    if (initial && this.#at === undefined && this.#bounds === undefined) this.#adopt(initial);
  }

  #modalHost(): HTMLDialogElement | null {
    return this.querySelector("dialog.aster-window-modal");
  }

  /** The wrapper follows open, minimized and modal; the panel itself never owns modality. */
  #syncModal(): void {
    const host = this.#modalHost();
    const panel = this.#panel();
    // Move the live panel to the wrapper the captured modality needs. Keeping
    // the same element preserves its DOM, focus memory and native input values.
    if (host && panel) {
      if (this.#shownModal && panel.parentElement !== host) host.append(panel);
      else if (!this.#shownModal && panel.parentElement === host) this.append(panel);
    }
    if (this.#modalQueued || !host) return;
    this.#modalQueued = true;
    // After the commit: showModal() moves focus, which must not re-enter the render effect.
    queueMicrotask(() => {
      this.#modalQueued = false;
      const host = this.#modalHost();
      if (!host) return;
      const wants = this.#shownModal && this.#open.peek() && this.#state.peek() !== "minimized";
      if (wants && !host.open) {
        // Modals don't stack: with a foreign modal open, showModal() throws.
        // Fall back to show(), which keeps the window usable inside that
        // modal's subtree and inert with the rest of the page otherwise.
        try {
          host.showModal();
        } catch {
          host.show();
        }
      } else if (!wants && host.open) this.#closeHost();
    });
  }

  #panel(): HTMLElement | null { return this.querySelector(".aster-window"); }
}

function sizeOf(panel: HTMLElement): { width: number; height: number } {
  return { width: panel.offsetWidth, height: panel.offsetHeight };
}

function beside(opener: HTMLElement | null, panel: HTMLElement): { x: number; y: number } {
  const r = opener?.getBoundingClientRect();
  if (!r) return { x: (innerWidth - panel.offsetWidth) / 2, y: (innerHeight - panel.offsetHeight) / 2 };
  const above = r.top - MARGIN - panel.offsetHeight;
  return { x: r.left, y: above >= MARGIN ? above : r.bottom + MARGIN };
}

define("aster-window", Window);
