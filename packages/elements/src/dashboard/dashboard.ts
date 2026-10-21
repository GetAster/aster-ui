import { PageScope } from "@getaster/data";
import { html } from "lit-html";
import { AsterElement, define, scopeOf, type View } from "../base/element.ts";
import { copyLayout, type DashboardConfig, type DashboardSize, type DashboardSnapshot, type DashboardWidget } from "./layout.ts";
import { DashboardPortlet, type DashboardWidgetType } from "./widget.ts";

/** CSS-owned composition; the page owns storage, shared data and widget factories. */
export class Dashboard extends AsterElement {
  readonly #label = this.prop("Dashboard");
  readonly #widgets = this.prop<readonly DashboardWidget[]>([]);
  readonly #maximized = this.prop<string | null>(null);
  readonly #busy = this.prop(false);
  readonly #message = this.prop("");
  readonly #registryVersion = this.prop(0);
  readonly #types = new Map<string, DashboardWidgetType>();
  readonly #cards = new Map<string, DashboardPortlet>();
  #generation = 0;
  #pending: { key: string; task: Promise<boolean> } | undefined;
  #focusAfter: string | null | undefined;
  #dragEnd: (() => void) | undefined;

  get label(): string { return this.#label.value; }
  set label(value: string) { this.#label.value = value; }
  get widgets(): readonly DashboardWidget[] { return this.#widgets.value; }
  get maximized(): string | null { return this.#maximized.value; }
  get busy(): boolean { return this.#busy.value; }

  override connectedCallback(): void {
    super.connectedCallback();
    const report = (event: Event) => {
      if (event.target === this) return;
      event.stopPropagation();
      this.emit("widgeterror", (event as CustomEvent<{ id: string; error: unknown }>).detail);
    };
    this.addEventListener("widgeterror", report);
    this.onDisconnect(() => this.removeEventListener("widgeterror", report));
  }

  registerType(name: string, type: DashboardWidgetType): () => void {
    if (!name.trim() || this.#types.has(name) || typeof type.create !== "function") throw new TypeError("Widget types require a unique name and create function");
    this.#types.set(name, type);
    this.#registryVersion.value++;
    let registered = true;
    return () => {
      if (!registered) return;
      if (this.#widgets.peek().some(widget => widget.type === name)) throw new Error("Remove widgets before unregistering their type");
      registered = false;
      this.#types.delete(name);
    };
  }

  add(widget: DashboardWidget): void {
    this.#assertIdle();
    if (!this.#types.has(widget.type)) throw new Error(`Unknown widget type: ${widget.type}`);
    this.#commit(copyLayout([...this.#widgets.peek(), widget]));
    this.#focusAfter = widget.id;
    this.#message.value = `${widget.title} added.`;
  }

  move(id: string, index: number): void {
    if (this.#busy.peek() || this.#maximized.peek()) return;
    if (!Number.isInteger(index)) throw new TypeError("Widget position must be an integer");
    const list = [...this.#widgets.peek()];
    const from = this.#index(id);
    const to = Math.max(0, Math.min(list.length - 1, index));
    if (from === to) return;
    const [widget] = list.splice(from, 1);
    list.splice(to, 0, widget!);
    this.#commit(list);
    this.#message.value = `${widget!.title} moved to position ${to + 1} of ${list.length}.`;
  }

  resize(id: string, width: DashboardSize, height: DashboardSize): void {
    if (this.#busy.peek() || this.#maximized.peek()) return;
    const widget = this.#widgets.peek()[this.#index(id)]!;
    const next = copyLayout(this.#widgets.peek().map(item => item.id === id ? { ...item, width, height } : item));
    this.#commit(next);
    this.#message.value = `${widget.title} size: ${width} columns by ${height} rows. Narrow screens may show fewer columns.`;
  }

  configure(id: string, config: DashboardConfig, title?: string): void {
    this.#assertIdle();
    this.#index(id);
    this.#commit(copyLayout(this.#widgets.peek().map(widget => widget.id === id ? { ...widget, config, ...(title === undefined ? {} : { title }) } : widget)));
  }

  maximize(id: string | null): void {
    if (this.#busy.peek() || document.querySelector("dialog:modal")) return;
    if (id !== null) this.#index(id);
    const previous = this.#maximized.peek();
    this.#maximized.value = id;
    queueMicrotask(() => {
      const card = this.#cards.get(id ?? previous ?? "");
      card?.querySelector<HTMLButtonElement>(".aster-widget-maximize")?.focus({ preventScroll: true });
    });
  }

  removeWidget(id: string): Promise<boolean> {
    const index = this.#index(id);
    const widget = this.#widgets.peek()[index]!;
    return this.#guard(`remove:${id}`, [id], () => {
      const next = this.#widgets.peek().filter(item => item.id !== id);
      this.#focusAfter = next[Math.min(index, next.length - 1)]?.id ?? null;
      this.#commit(next);
      this.#message.value = `${widget.title} removed.`;
    });
  }

  retry(id: string): Promise<boolean> {
    this.#index(id);
    return this.#guard(`retry:${id}`, [id], () => {
      const card = this.#cards.get(id);
      const spec = this.#widgets.peek().find(widget => widget.id === id)!;
      card?.dispose();
      if (card) void card.mount(this.#types.get(spec.type));
    });
  }

  snapshot(): DashboardSnapshot { return { version: 1, widgets: copyLayout(this.#widgets.peek()) }; }

  restore(snapshot: DashboardSnapshot): Promise<boolean> {
    if (snapshot?.version !== 1) throw new TypeError("Unsupported dashboard layout version");
    const next = copyLayout(snapshot.widgets);
    const removed = this.#widgets.peek().filter(widget => !next.some(item => item.id === widget.id && item.type === widget.type)).map(widget => widget.id);
    return this.#guard(`layout:${JSON.stringify(next)}`, removed, () => {
      const active = document.activeElement;
      if (removed.some(id => this.#cards.get(id)?.contains(active))) this.#focusAfter = next[0]?.id ?? null;
      this.#commit(next);
      this.#message.value = "Dashboard layout restored.";
    });
  }

  override disconnectedCallback(): void {
    this.#generation++;
    this.#pending = undefined;
    this.#busy.value = false;
    this.#dragEnd?.();
    for (const card of this.#cards.values()) { card.dispose(); card.remove(); }
    this.#cards.clear();
    super.disconnectedCallback();
  }

  protected render(): View {
    this.#registryVersion.value;
    this.#widgets.value;
    this.#maximized.value;
    return html`<section class="aster-dashboard" aria-label=${this.#label.value}>
      <div class="aster-dashboard-status aster-sr-only" role="status" aria-live="polite">${this.#message.value}</div>
      <div class="aster-dashboard-grid" role="list" aria-label=${`${this.#label.value} widgets`} tabindex="-1" aria-busy=${String(this.#busy.value)}></div>
      ${this.#widgets.value.length ? html`` : html`<p class="aster-dashboard-empty">No widgets yet. Add a widget to build your dashboard.</p>`}
    </section>`;
  }

  protected override updated(): void {
    const grid = this.querySelector<HTMLElement>(".aster-dashboard-grid")!;
    const widgets = this.#widgets.peek();
    const focused = document.activeElement as HTMLElement | null;
    for (const [id, card] of this.#cards) {
      const spec = widgets.find(widget => widget.id === id);
      if (!spec || card.dataset.type !== spec.type) { card.dispose(); card.remove(); this.#cards.delete(id); }
    }
    let cursor = grid.firstElementChild;
    for (const widget of widgets) {
      let card = this.#cards.get(widget.id);
      if (!card) {
        card = new DashboardPortlet();
        card.dataset.type = widget.type;
        card.initialize(widget, scopeOf(this)?.child() ?? new PageScope(), {
          move: by => this.move(widget.id, this.#index(widget.id) + by),
          resize: (w, h) => {
            const current = this.#widgets.peek()[this.#index(widget.id)]!;
            this.resize(widget.id, limit(current.width + w), limit(current.height + h));
          },
          maximize: () => this.maximize(this.#maximized.peek() === widget.id ? null : widget.id),
          remove: () => { void this.removeWidget(widget.id); },
          retry: () => { void this.retry(widget.id); },
          drag: event => this.#drag(widget.id, event),
          edges: () => ({ first: this.#index(widget.id) === 0, last: this.#index(widget.id) === this.#widgets.peek().length - 1 }),
        });
        this.#cards.set(widget.id, card);
      }
      card.update(widget, this.#maximized.peek() === widget.id, this.#busy.peek());
      if (card !== cursor) grid.insertBefore(card, cursor);
      cursor = card.nextElementSibling;
      void card.mount(this.#types.get(widget.type));
    }
    if (focused?.isConnected && grid.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
    const focus = this.#focusAfter;
    if (focus !== undefined && !this.#busy.peek()) {
      this.#focusAfter = undefined;
      const generation = this.#generation;
      requestAnimationFrame(() => {
        if (generation !== this.#generation || !this.isConnected || document.querySelector("dialog:modal")) return;
        if (focus === null) grid.focus({ preventScroll: true });
        else this.#cards.get(focus)?.focusActions();
      });
    }
  }

  #guard(key: string, ids: readonly string[], apply: () => void): Promise<boolean> {
    if (this.#pending) return this.#pending.key === key ? this.#pending.task : Promise.resolve(false);
    const generation = this.#generation;
    this.#busy.value = true;
    const task = Promise.resolve().then(async () => {
      for (const id of ids) {
        if (!(await this.#cards.get(id)?.allowRemove() ?? true)) return false;
        if (generation !== this.#generation || !this.isConnected) return false;
      }
      if (generation !== this.#generation || !this.isConnected) return false;
      apply();
      return true;
    }).catch((error: unknown) => {
      if (generation === this.#generation) {
        this.#message.value = "Layout change failed. Your widgets remain open.";
        this.emit("layouterror", error);
      }
      return false;
    }).finally(() => {
      if (generation === this.#generation) { this.#pending = undefined; this.#busy.value = false; }
    });
    this.#pending = { key, task };
    return task;
  }

  #commit(widgets: readonly DashboardWidget[]): void {
    if (!widgets.some(widget => widget.id === this.#maximized.peek())) this.#maximized.value = null;
    this.#widgets.value = Object.freeze([...widgets]);
    this.emit("layoutchange", this.snapshot());
  }

  #index(id: string): number {
    const index = this.#widgets.peek().findIndex(widget => widget.id === id);
    if (index < 0) throw new Error(`Unknown dashboard widget: ${id}`);
    return index;
  }

  #assertIdle(): void { if (this.#busy.peek()) throw new Error("A dashboard layout change is pending"); }

  #drag(id: string, event: PointerEvent): void {
    if (event.button !== 0 || this.#busy.peek() || this.#maximized.peek()) return;
    const handle = event.currentTarget as HTMLElement;
    this.#dragEnd?.();
    let target: DashboardPortlet | undefined;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    handle.focus({ preventScroll: true });
    const clear = () => { if (target) delete target.dataset.drop; };
    const move = (e: PointerEvent) => {
      clear();
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest("aster-dashboard-widget");
      target = [...this.#cards.values()].find(card => card === hit && card.dataset.widget !== id);
      if (target) target.dataset.drop = "true";
    };
    const finish = () => {
      clear();
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", drop);
      handle.removeEventListener("pointercancel", cancel);
      handle.removeEventListener("keydown", escape);
      this.#dragEnd = undefined;
    };
    const drop = () => { const to = target?.dataset.widget; finish(); if (to) this.move(id, this.#index(to)); };
    const cancel = () => { finish(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", drop);
    handle.addEventListener("pointercancel", cancel);
    handle.addEventListener("keydown", escape);
    this.#dragEnd = cancel;
  }
}

function limit(value: number): DashboardSize { return Math.max(1, Math.min(3, value)) as DashboardSize; }

define("aster-dashboard", Dashboard);
