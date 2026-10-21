import { html, nothing } from "lit-html";
import { AsterElement, define, uid, type View } from "../base/element.ts";
import { openWhen } from "../overlay/anchor.ts";
import { windowBar } from "./chrome.ts";

const STEP = 16;
const BIG_STEP = 64;
const MARGIN = 8;

export type WindowState = "normal" | "maximized" | "minimized";
export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface WindowPlacement { state: WindowState; bounds?: WindowBounds; restoreMaximized?: boolean }

/** Non-modal chrome; content ownership stays with the host page. */
export class Window extends AsterElement {
  readonly #content = this.prop<View>(nothing);
  readonly #heading = this.prop("");
  readonly #open = this.prop(false);
  readonly #state = this.prop<WindowState>("normal");
  readonly #managed = this.prop(false);
  readonly #active = this.prop(false);
  readonly #preserve = this.prop(false);
  readonly #closing = this.prop(false);
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
      this.#opener = opener;
      this.#mounted = true;
      this.#open.value = true;
    }
    if (this.#state.peek() === "minimized") this.#state.value = this.#restoreMaximized ? "maximized" : "normal";
    requestAnimationFrame(() => {
      if (!this.isConnected || !this.#open.peek()) return;
      const panel = this.#panel();
      if (!panel) return;
      if (this.#state.peek() === "normal") this.#place(this.#at ?? beside(opener, panel));
      this.#applySize();
      this.activate();
      this.emit("statechange", this.#state.peek());
    });
  }

  /** Activates chrome without reparenting the content or recreating its models. */
  activate(focus = true): void {
    const panel = this.#panel();
    if (!panel || !this.#open.peek() || this.#state.peek() === "minimized" || document.querySelector("dialog:modal")) return;
    if (!this.#active.peek()) {
      const previous = document.activeElement;
      this.#active.value = true;
      // Top-layer order is insertion order; z-index cannot raise a popover.
      if (panel.matches(":popover-open")) panel.hidePopover();
      panel.showPopover();
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
    this.#panel()?.hidePopover();
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
    return { state: this.#state.peek(), ...(this.#bounds ? { bounds: { ...this.#bounds } } : {}), restoreMaximized: this.#restoreMaximized };
  }

  /** Invalid persisted data is rejected atomically. CSS limits size to the viewport. */
  setPlacement(value: WindowPlacement): void {
    if (!["normal", "maximized", "minimized"].includes(value?.state)) throw new TypeError("Invalid window state");
    const b = value.bounds;
    if (b && (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0)) throw new TypeError("Invalid window bounds");
    this.#bounds = b ? { ...b } : undefined;
    this.#at = b ? { x: b.x, y: b.y } : undefined;
    this.#restoreMaximized = value.restoreMaximized === true;
    this.#state.value = value.state;
    requestAnimationFrame(() => this.#applySize());
  }

  protected override updated(): void {
    this.#observe();
    if (this.#open.peek() && this.#state.peek() !== "minimized") this.#applySize();
  }

  protected render(): View {
    const open = this.#open.value;
    const state = this.#state.value;
    const preserve = this.#preserve.value;
    if (!open && !(preserve && this.#mounted)) return nothing;
    const heading = `${this.#id}-heading`;
    const managed = this.#managed.value;
    return html`<div class="aster-window" popover="manual" role="dialog" aria-modal="false" aria-labelledby=${heading}
      data-state=${state} data-active=${String(this.#active.value)} aria-busy=${String(this.#closing.value)}
      tabindex="-1" ${openWhen(open && state !== "minimized")}
      @pointerdown=${() => this.activate(false)} @focusin=${() => { this.#rememberFocus(); this.activate(false); }}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        void this.close();
      }}>
      ${windowBar(heading, this.#heading.value, html`<button type="button" class="aster-window-move" aria-label=${`Move ${this.#heading.value}`}
          ?disabled=${state !== "normal"} aria-describedby=${`${this.#id}-move-help`}
          @keydown=${(e: KeyboardEvent) => this.#geometryKey(e, false)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2"/></svg>
        </button>
        <span id=${`${this.#id}-move-help`} hidden>Arrow keys move the window; with Shift, further.</span>
        <button type="button" aria-label=${`Resize ${this.#heading.value}`} ?disabled=${state !== "normal"}
          aria-describedby=${`${this.#id}-resize-help`} @keydown=${(e: KeyboardEvent) => this.#geometryKey(e, true)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13 13 3M7 3h6v6M3 7v6h6"/></svg>
        </button>
        <span id=${`${this.#id}-resize-help`} hidden>Arrow keys resize the window; with Shift, further.</span>
        ${managed ? html`<button type="button" aria-label=${`Minimize ${this.#heading.value}`} @click=${() => this.minimize()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12h10"/></svg></button>
          <button type="button" aria-label=${`${state === "maximized" ? "Restore" : "Maximize"} ${this.#heading.value}`}
            @click=${() => state === "maximized" ? this.restore() : this.maximize()}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10v10H3zM3 6h10"/></svg></button>` : nothing}
        <button type="button" class="aster-window-close" aria-label=${`Close ${this.#heading.value}`} ?disabled=${this.#closing.value} @click=${() => void this.close()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>`, (event) => this.#drag(event))}
      <div class="aster-window-body">${this.#content.value}</div>
    </div>`;
  }

  #finishClose(): void {
    const returnFocus = this.#active.peek() || this.#panel()?.contains(document.activeElement);
    this.#rememberFocus();
    this.#capture();
    this.#open.value = false;
    this.#active.value = false;
    this.#panel()?.hidePopover();
    if (returnFocus) this.#returnFocus();
    this.emit("close");
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
    if (this.#state.peek() !== "normal") return;
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
    if (!panel?.matches(":popover-open") || this.#state.peek() !== "normal" || panel.dataset.state !== "normal") return;
    const r = panel.getBoundingClientRect();
    this.#bounds = { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  #applySize(): void {
    const panel = this.#panel();
    if (!panel) return;
    if (this.#bounds) {
      panel.style.width = `${this.#bounds.width}px`;
      panel.style.height = `${this.#bounds.height}px`;
    }
    this.#recover();
  }

  #recover(): void {
    if (this.#state.peek() === "normal" && this.#at && this.#panel()?.matches(":popover-open")) this.#place(this.#at);
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
    const x = Math.max(MARGIN, Math.min(to.x, innerWidth - panel.offsetWidth - MARGIN));
    const y = Math.max(MARGIN, Math.min(to.y, innerHeight - panel.offsetHeight - MARGIN));
    this.#at = { x, y };
    panel.style.setProperty("--window-x", `${x}px`);
    panel.style.setProperty("--window-y", `${y}px`);
  }

  #panel(): HTMLElement | null { return this.querySelector(".aster-window"); }
}

function beside(opener: HTMLElement | null, panel: HTMLElement): { x: number; y: number } {
  const r = opener?.getBoundingClientRect();
  if (!r) return { x: (innerWidth - panel.offsetWidth) / 2, y: (innerHeight - panel.offsetHeight) / 2 };
  const above = r.top - MARGIN - panel.offsetHeight;
  return { x: r.left, y: above >= MARGIN ? above : r.bottom + MARGIN };
}

define("aster-window", Window);
