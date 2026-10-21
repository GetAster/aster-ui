import { signal, type ReadonlySignal } from "@preact/signals-core";
import type { PageScope } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, define, provideScope, uid, type View } from "../base/element.ts";
import { windowBar } from "../window/chrome.ts";
import { openWhen } from "../overlay/anchor.ts";
import { Menu, type MenuItem } from "../menu/menu.ts";
import type { DashboardConfig, DashboardWidget } from "./layout.ts";

export interface DashboardMount {
  readonly id: string;
  readonly scope: PageScope;
  readonly config: ReadonlySignal<DashboardConfig>;
  readonly signal: AbortSignal;
}

export interface DashboardSession {
  render(): View;
  dispose(): void;
  beforeRemove?(): boolean | Promise<boolean>;
}

export interface DashboardWidgetType {
  create(context: DashboardMount): DashboardSession | Promise<DashboardSession>;
}

interface Actions {
  move(by: number): void;
  resize(width: number, height: number): void;
  maximize(): void;
  remove(): void;
  retry(): void;
  drag(event: PointerEvent): void;
  edges(): { first: boolean; last: boolean };
}

/** The dashboard owns sessions; native DOM moves only reconnect the view. */
export class DashboardPortlet extends AsterElement {
  readonly #widget = this.prop<DashboardWidget | undefined>(undefined);
  readonly #maximized = this.prop(false);
  readonly #busy = this.prop(false);
  readonly #status = this.prop<"unavailable" | "loading" | "ready" | "error">("unavailable");
  readonly #config = signal<DashboardConfig>({});
  readonly #id = uid("aster-widget");
  #scope!: PageScope;
  #actions!: Actions;
  #session: DashboardSession | undefined;
  #abort: AbortController | undefined;
  #generation = 0;
  #started = false;

  initialize(widget: DashboardWidget, scope: PageScope, actions: Actions): void {
    this.#scope = scope;
    this.#actions = actions;
    provideScope(this, scope);
    this.setAttribute("role", "listitem");
    this.update(widget, false, false);
  }

  update(widget: DashboardWidget, maximized: boolean, busy: boolean): void {
    this.#widget.value = widget;
    this.#maximized.value = maximized;
    this.#busy.value = busy;
    if (JSON.stringify(widget.config ?? {}) !== JSON.stringify(this.#config.peek())) this.#config.value = widget.config ?? {};
    this.dataset.widget = widget.id;
    this.dataset.width = String(widget.width);
    this.dataset.height = String(widget.height);
  }

  async mount(type: DashboardWidgetType | undefined): Promise<void> {
    if (!type || this.#started) return;
    this.#started = true;
    const generation = ++this.#generation;
    const abort = new AbortController();
    this.#abort = abort;
    this.#status.value = "loading";
    try {
      const session = await type.create({ id: this.#widget.peek()!.id, config: this.#config, scope: this.#scope, signal: abort.signal });
      if (generation !== this.#generation || abort.signal.aborted) { session.dispose(); return; }
      this.#session = session;
      this.#status.value = "ready";
    } catch (error) {
      if (generation === this.#generation) this.#fail(error);
    }
  }

  async allowRemove(): Promise<boolean> { return await this.#session?.beforeRemove?.() ?? true; }

  dispose(): void {
    this.#generation++;
    this.#abort?.abort(); this.#abort = undefined;
    const session = this.#session; this.#session = undefined;
    this.#started = false;
    try { session?.dispose(); } catch (error) { this.#report(error); }
    this.#status.value = "unavailable";
  }

  focusActions(): void { this.querySelector<HTMLButtonElement>(".aster-widget-actions")?.focus(); }

  protected render(): View {
    const widget = this.#widget.value;
    if (!widget) return nothing;
    const max = this.#maximized.value;
    const busy = this.#busy.value;
    return html`<section class="aster-portlet" data-maximized=${String(max)} role=${max ? "dialog" : "region"}
      aria-modal=${max ? "false" : nothing} aria-labelledby=${this.#id} popover=${max ? "manual" : nothing}
      ${openWhen(max)} @keydown=${(event: KeyboardEvent) => {
        if (max && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault(); event.stopPropagation(); this.#actions.maximize();
        }
      }}>
      ${windowBar(this.#id, widget.title, html`
        <button type="button" aria-label=${`Move ${widget.title}`} ?disabled=${busy || max}
          aria-describedby=${`${this.#id}-move`} @pointerdown=${(event: PointerEvent) => this.#actions.drag(event)}
          @keydown=${(event: KeyboardEvent) => this.#key(event, false)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12M8 2 6 4m2-2 2 2M2 8l2-2m-2 2 2 2M14 8l-2-2m2 2-2 2M8 14l-2-2m2 2 2-2"/></svg>
        </button>
        <span id=${`${this.#id}-move`} hidden>Drag onto another widget, or use arrow keys to move earlier or later. The actions menu offers the same controls.</span>
        <button type="button" aria-label=${`Resize ${widget.title}`} ?disabled=${busy || max}
          aria-describedby=${`${this.#id}-resize`} @keydown=${(event: KeyboardEvent) => this.#key(event, true)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13 13 3M7 3h6v6M3 7v6h6"/></svg>
        </button>
        <span id=${`${this.#id}-resize`} hidden>Left and right change width; up and down change height. The actions menu offers the same controls.</span>
        <button type="button" class="aster-widget-actions" aria-label=${`Actions for ${widget.title}`} aria-haspopup="menu" ?disabled=${busy}
          @click=${(event: MouseEvent) => this.#menu(event.currentTarget as HTMLElement)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h.1M8 8h.1M13 8h.1" stroke-width="3"/></svg>
        </button>
        <button type="button" class="aster-widget-maximize" aria-label=${`${max ? "Restore" : "Maximize"} ${widget.title}`} ?disabled=${busy}
          @click=${() => this.#actions.maximize()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10v10H3zM3 6h10"/></svg></button>
        <button type="button" aria-label=${`Remove ${widget.title}`} ?disabled=${busy} @click=${() => this.#actions.remove()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg></button>`)}
      <div class="aster-portlet-body" aria-busy=${String(this.#status.value === "loading")}>${this.#body()}</div>
      <aster-menu></aster-menu>
    </section>`;
  }

  #body(): View {
    switch (this.#status.value) {
      case "ready":
        try { return this.#session!.render(); }
        catch (error) {
          const generation = this.#generation;
          queueMicrotask(() => { if (generation === this.#generation && this.#status.peek() !== "error") this.#fail(error); });
          return html`<p role="status">Widget content unavailable.</p>`;
        }
      case "loading": return html`<p role="status">Loading widget…</p>`;
      case "error": return html`<p role="status">Widget content unavailable. <button type="button" class="aster-button" @click=${() => this.#actions.retry()}>Retry widget</button></p>`;
      default: return html`<p role="status">This widget type is unavailable. Its saved configuration is retained.</p>`;
    }
  }

  #fail(error: unknown): void { this.#status.value = "error"; this.#report(error); }
  #report(error: unknown): void { this.emit("widgeterror", { id: this.#widget.peek()!.id, error }); }

  #key(event: KeyboardEvent, resize: boolean): void {
    if (this.#busy.peek() || this.#maximized.peek()) return;
    const changes: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const by = changes[event.key];
    if (!by) return;
    event.preventDefault();
    if (resize) this.#actions.resize(by[0], by[1]);
    else this.#actions.move(by[0] || by[1]);
  }

  #menu(anchor: HTMLElement): void {
    const widget = this.#widget.peek()!;
    const edges = this.#actions.edges();
    const disabled = this.#maximized.peek() ? "Restore this widget before changing its layout." : undefined;
    const action = (label: string, reason: string | undefined, run: () => void): MenuItem => ({ label, ...(reason ? { disabled: reason } : {}), run });
    const items: MenuItem[] = [
      action("Move earlier", disabled ?? (edges.first ? "Already first." : undefined), () => this.#actions.move(-1)),
      action("Move later", disabled ?? (edges.last ? "Already last." : undefined), () => this.#actions.move(1)),
      { kind: "separator" },
      action("Narrower", disabled ?? (widget.width === 1 ? "Already narrowest." : undefined), () => this.#actions.resize(-1, 0)),
      action("Wider", disabled ?? (widget.width === 3 ? "Already widest." : undefined), () => this.#actions.resize(1, 0)),
      action("Shorter", disabled ?? (widget.height === 1 ? "Already shortest." : undefined), () => this.#actions.resize(0, -1)),
      action("Taller", disabled ?? (widget.height === 3 ? "Already tallest." : undefined), () => this.#actions.resize(0, 1)),
    ];
    this.querySelector<Menu>("aster-menu")!.openFrom(anchor, items, `Layout for ${widget.title}`);
  }
}

define("aster-dashboard-widget", DashboardPortlet);
