import { batch, effect } from "@preact/signals-core";
import { selectionPublication, type Collection, type Entity, type KeyText, type Selection } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, define, each, scopeOf, uid, type View } from "../base/element.ts";
import { TileScroll } from "./scroll.ts";
import { Menu, type MenuItem } from "../menu/menu.ts";

export interface TileState {
  readonly key: KeyText;
  /** Position in the collection, not in the subset of loaded tiles. */
  readonly index: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly hidden: ReadonlySet<string>;
  /** One-based pick order, only in ordered selection mode. */
  readonly selectionOrder: number | undefined;
}

export interface TileContent {
  readonly title: string;
  readonly description?: string;
  readonly image?: string;
  readonly imageAlt?: string;
  readonly icon?: View;
}

export type TileRenderer = (entity: Entity, state: TileState) => View;
export type TilePresenter = (entity: Entity, state: TileState) => TileContent;
export interface TileOpenDetail { readonly key: KeyText; }

type Tile = { readonly entity: Entity; readonly state: TileState; readonly content: TileContent };
const CONTROLS = 'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]';
const NONE: ReadonlySet<string> = new Set();

/** A collection layout grid, with optional uniform-row windowing and paging. */
export class TileGrid extends AsterElement {
  readonly #collection = this.prop<Collection | undefined>(undefined);
  readonly #selection = this.prop<Selection | undefined>(undefined);
  readonly #selectable = this.prop(true);
  readonly #label = this.prop("");
  readonly #publish = this.prop("");
  readonly #present = this.prop<TilePresenter | undefined>(undefined);
  readonly #tile = this.prop<TileRenderer | undefined>(undefined);
  readonly #actions = this.prop<((entity: Entity, state: TileState) => readonly MenuItem[]) | undefined>(undefined);
  readonly #empty = this.prop<View>(html`<p>No records.</p>`);
  readonly #layout = this.prop<"uniform" | "content">("uniform");
  readonly #active = this.prop<KeyText | undefined>(undefined);
  readonly #inside = this.prop<KeyText | undefined>(undefined);
  readonly #columns = this.prop(1);
  readonly #virtual = this.prop(false);
  readonly #top = this.prop(0);
  readonly #height = this.prop(1);
  readonly #stride = this.prop(240);
  readonly #gap = this.prop(0);
  readonly #notice = this.prop("");
  #requested = "";
  #loading: object | undefined;
  #query: Collection["query"] | undefined;
  #bound: Collection | undefined;
  #navigation = 0;
  #failedFocus: number | undefined;
  readonly #pendingFocus = this.prop<number | undefined>(undefined);
  #retrying = false;
  readonly #id = uid("aster-tile-grid");
  readonly #tabStops = new WeakMap<HTMLElement, string | null>();
  #anchor: KeyText | undefined;
  #anchorPosition: number | undefined;
  #anchorQuery: Collection["query"] | undefined;
  #previous: readonly KeyText[] = [];
  #focusBefore: Element | null = null;
  #resize: ResizeObserver | undefined;
  #mutations: MutationObserver | undefined;
  #observed: HTMLElement | undefined;
  #menu: Menu | undefined;
  #search = "";
  #searchedAt = 0;

  get collection(): Collection | undefined { return this.#collection.value ?? this.#selection.value?.collection; }
  set collection(v: Collection | undefined) { this.#collection.value = v; }
  get selection(): Selection | undefined { return this.#selection.value; }
  /** Allows this view to change selection; borrowed selection state remains visible. */
  get selectable(): boolean { return this.#selectable.value; }
  set selectable(value: boolean) {
    const restore = !value && document.activeElement instanceof Element && this.contains(document.activeElement) && !!document.activeElement.closest("[data-selection-action]");
    this.#selectable.value = value;
    if (restore) { this.#inside.value = undefined; queueMicrotask(() => this.focus({ preventScroll: true })); }
  }
  set selection(v: Selection | undefined) {
    this.#selection.value = v;
    this.#notice.value = "";
    this.#anchor = undefined;
    this.#anchorPosition = undefined;
  }
  get label(): string { return this.#label.value; }
  set label(v: string) { this.#label.value = v; }
  get publish(): string { return this.#publish.value; }
  set publish(v: string) { this.#publish.value = v; }
  get presentTile(): TilePresenter | undefined { return this.#present.value; }
  set presentTile(v: TilePresenter | undefined) { this.#present.value = v; }
  get renderTile(): TileRenderer | undefined { return this.#tile.value; }
  set renderTile(v: TileRenderer | undefined) { this.#tile.value = v; }
  get actions(): ((entity: Entity, state: TileState) => readonly MenuItem[]) | undefined { return this.#actions.value; }
  set actions(v: ((entity: Entity, state: TileState) => readonly MenuItem[]) | undefined) { this.#actions.value = v; }
  get empty(): View { return this.#empty.value; }
  set empty(v: View) { this.#empty.value = v; }
  get layout(): "uniform" | "content" { return this.#layout.value; }
  set layout(v: "uniform" | "content") { this.#layout.value = v; }
  /** Window uniform rows and load their pages. Content layout remains owner-loaded. */
  get virtualized(): boolean { return this.#virtual.value; }
  set virtualized(v: boolean) { this.#virtual.value = v; }
  get activeKey(): KeyText | undefined { return this.#active.value; }

  override connectedCallback(): void {
    super.connectedCallback();
    this.onDisconnect(effect(() => {
      const key = this.#publish.value;
      const selection = this.#selection.value;
      const scope = scopeOf(this);
      return key && selection && scope ? scope.publish(key, selectionPublication(selection)) : undefined;
    }));
  }

  override disconnectedCallback(): void {
    this.#navigation++;
    this.#requested = "";
    this.#loading = undefined;
    this.#resize?.disconnect();
    this.#mutations?.disconnect();
    this.#observed = undefined;
    this.#menu?.remove();
    this.#menu = undefined;
    super.disconnectedCallback();
  }

  override focus(options?: FocusOptions): void {
    (this.tileFor(this.#active.peek()) ?? this.#grid())?.focus(options);
  }

  tileFor(key: KeyText | undefined): HTMLElement | undefined {
    const id = key === undefined ? undefined : this.#tileId(key);
    return id ? this.querySelector<HTMLElement>(`#${id}`) ?? undefined : undefined;
  }

  /** Reveals a loaded key, even when its tile is outside the current window. */
  focusTile(key: KeyText): void {
    const index = this.collection?.keys.peek().indexOf(key) ?? -1;
    if (index < 0) return;
    this.#navigation++;
    this.#pendingFocus.value = undefined;
    this.#failedFocus = undefined;
    this.#active.value = key;
    this.#inside.value = undefined;
    if (this.#windowed()) this.#reveal(index);
    queueMicrotask(() => {
      this.tileFor(key)?.focus({ preventScroll: true });
      (this.#windowed() ? this.#grid() : this.tileFor(key))?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    });
  }

  /** Loads and focuses a logical position. Returns false on failure or stale navigation. */
  async focusIndex(index: number): Promise<boolean> {
    const collection = this.collection;
    if (!collection || !Number.isSafeInteger(index) || index < 0) return false;
    const generation = ++this.#navigation;
    const query = collection.query;
    this.#failedFocus = undefined;
    this.#notice.value = "";
    this.#pendingFocus.value = index;
    try {
      await collection.view(index, index + 1, [index, collection.keys.peek().indexOf(this.#active.peek() ?? "")]);
      if (generation !== this.#navigation || this.collection !== collection || collection.query !== query || !this.isConnected) return false;
      const key = collection.keys.peek()[index];
      if (key === undefined) return false;
      this.focusTile(key);
      return true;
    } catch {
      if (generation === this.#navigation && collection.query === query) {
        this.#failedFocus = index;
        this.#notice.value = "Could not load that tile. Retry loading, or move to another tile.";
      }
      return false;
    } finally {
      if (generation === this.#navigation) this.#pendingFocus.value = undefined;
    }
  }

  #windowed(): boolean { return this.#virtual.value && this.#layout.value === "uniform"; }

  #scroll(): TileScroll {
    const count = this.collection?.count.value ?? this.collection?.pageSize ?? 0;
    return new TileScroll(Math.ceil(count / this.#columns.value), this.#stride.value, this.#height.value, this.#gap.value);
  }

  #reveal(index: number): void {
    const grid = this.#grid();
    if (!grid) return;
    const top = Math.floor(index / this.#columns.peek()) * this.#stride.peek();
    const bottom = top + this.#stride.peek();
    const model = this.#scroll();
    const current = model.logical(grid.scrollTop);
    if (top < current) grid.scrollTop = model.physical(top);
    else if (bottom > current + this.#height.peek()) grid.scrollTop = model.physical(bottom - this.#height.peek());
    this.#top.value = grid.scrollTop;
  }

  protected render(): View {
    this.#focusBefore = this.contains(document.activeElement) ? document.activeElement : null;
    const collection = this.collection;
    if (!collection) return nothing;
    const slots = collection.keys.value;
    const virtual = this.#windowed();
    const cols = this.#columns.value;
    const count = collection.count.value ?? (virtual ? collection.pageSize : slots.length);
    const rowCount = Math.ceil(count / cols);
    const model = this.#scroll();
    const logicalTop = model.logical(this.#top.value);
    const start = virtual ? Math.max(0, Math.floor(logicalTop / this.#stride.value) - 2) : 0;
    const end = virtual ? Math.min(rowCount, Math.ceil((logicalTop + this.#height.value) / this.#stride.value) + 2) : rowCount;
    const chosen = this.#selection.value?.keys.value ?? [];
    const old = this.#active.value;
    const keys = virtual ? slots.slice(start * cols, end * cols).filter((k): k is KeyText => k !== undefined) : slots.filter((k): k is KeyText => k !== undefined);
    const active = old !== undefined && slots.includes(old) ? old
      : keys[Math.max(0, Math.min(keys.length - 1, this.#previous.indexOf(old ?? "")))];
    this.#previous = keys;
    const indices = virtual ? Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i)
      : [...new Set(slots.flatMap((key, i) => key === undefined ? [] : [Math.floor(i / cols)]))];
    // The navigation row stays mounted, preserving the grid's single tab entry.
    const pinned = active !== undefined ? Math.floor(slots.indexOf(active) / cols) : -1;
    if (virtual && pinned >= 0 && !indices.includes(pinned)) indices.push(pinned);
    indices.sort((a, b) => a - b);
    const tiles: Tile[] = [];
    const rows = indices.map((index) => {
      const cells = Array.from({ length: Math.min(cols, count - index * cols) }, (_, col) => {
        const position = index * cols + col;
        const key = slots[position];
        const tile = key === undefined ? undefined : this.#tileAt(position, active, chosen);
        if (!tile) return { position, tile: undefined };
        tiles.push(tile);
        return { position, tile };
      });
      return { index, cells };
    });
    const status = collection.status.value;
    const exact = collection.counted.value && !collection.estimated.value;
    return html`<div class="aster-tile-grid" role="grid" aria-label=${this.#label.value}
      aria-describedby=${`${this.#id}-help`} aria-multiselectable=${this.#selectable.value && this.#selection.value?.multiple ? "true" : nothing}
      aria-rowcount=${exact ? Math.max(1, rowCount) : -1} aria-colcount=${cols}
      tabindex=${tiles.length ? -1 : 0} data-layout=${this.#layout.value} data-virtual=${String(virtual)}
      aria-busy=${status === "loading" ? "true" : "false"}
      @scroll=${(e: Event) => { if (virtual) this.#top.value = (e.currentTarget as HTMLElement).scrollTop; }}
      @keydown=${(e: KeyboardEvent) => this.#key(e, tiles, cols)}
      @click=${(e: MouseEvent) => this.#click(e)}
      @dblclick=${(e: MouseEvent) => this.#doubleClick(e)}
      @contextmenu=${(e: MouseEvent) => this.#context(e, tiles)}
      @focusin=${(e: FocusEvent) => this.#focusIn(e)}
      @focusout=${() => queueMicrotask(() => {
        if (!this.contains(document.activeElement)) {
          this.#inside.value = undefined;
          this.#navigation++;
              }
      })}>
      <div class="aster-tile-canvas" style=${virtual ? `height: ${model.extent}px` : nothing}>
        ${each(rows, (r) => String(r.index), (r) => html`<div class="aster-tile-row" role="row" aria-rowindex=${r.index + 1}
          data-pinned=${String(virtual && (r.index < start || r.index >= end))}
          style=${virtual ? `top: ${(r.index < start || r.index >= end) ? Math.max(0, Math.min(model.extent - this.#stride.value + this.#gap.value, model.rowTop(r.index * this.#stride.value, this.#top.value))) : model.rowTop(r.index * this.#stride.value, this.#top.value)}px` : nothing}>
          ${each(r.cells, (c) => c.tile?.state.key ?? `placeholder-${c.position}`, (c) => c.tile ? this.#renderTile(c.tile, c.position % cols) : virtual ? html`
            <div class="aster-tile aster-tile-placeholder" role="gridcell" aria-disabled="true" aria-colindex=${c.position % cols + 1}
              aria-label=${`Loading record ${c.position + 1}`}><span>Loading…</span></div>` : nothing)}
        </div>`)}
      </div>
      ${count === 0 || (!virtual && tiles.length === 0) ? html`<div class="aster-tile-empty" role="row"><div role="gridcell">
        ${status === "loading" ? html`<p>Loading…</p>` : collection.count.value === 0 ? this.#empty.value : html`<p>No records loaded.</p>`}
      </div></div>` : nothing}
    </div>
    <p class="aster-sr-only" id=${`${this.#id}-help`}>Arrow keys move between tiles. ${this.#selectable.value ? "Space selects." : "Selection is controlled by another view."} Enter opens. F2 enters actions; Escape returns to the tile.
      ${this.#selectable.value && this.#selection.value?.ordered ? "Alt+Up and Alt+Down change selection order." : ""}</p>
    <div class="aster-tile-status" role="status" aria-live="polite" aria-atomic="true">
      ${status === "error" ? html`<span>Could not load records.</span>` : collection.count.value === undefined ? "Loading…"
        : exact ? `${count} records` : "More records may be available."}
      ${this.#notice.value}
    </div>
    ${status === "error" && virtual ? html`<button type="button" class="aster-button" @click=${() => this.#retry()}>Retry loading tiles</button>` : nothing}
    `;
  }

  #tileAt(index: number, active: KeyText | undefined, chosen: readonly KeyText[]): Tile | undefined {
    const collection = this.collection!;
    const key = collection.keys.value[index];
    const stored = collection.recordAt(index);
    if (key === undefined || !stored) return undefined;
    const state: TileState = { key, index, selected: chosen.includes(key), focused: key === active,
      hidden: stored.hidden ?? NONE, selectionOrder: this.#selection.value?.ordered && chosen.includes(key) ? chosen.indexOf(key) + 1 : undefined };
    const field = collection.type.titleField;
    const title = field && state.hidden.has(field) ? "Hidden" : String((field ? stored.entity[field] : undefined) ?? key);
    return { entity: stored.entity, state, content: this.#present.value?.(stored.entity, state) ?? { title } };
  }

  #renderTile(t: Tile, col: number): View {
    const { content, state } = t;
    const id = this.#tileId(state.key);
    const menu = this.#actions.value?.(t.entity, state) ?? [];
    const custom = this.#tile.value;
    return html`<div class="aster-tile" id=${id} role="gridcell" data-key=${state.key}
      aria-label=${content.title} aria-describedby=${content.description || state.selectionOrder ? `${id}-description` : nothing}
      aria-colindex=${col + 1} aria-selected=${this.#selection.value ? String(state.selected) : nothing}
      data-interaction=${String(this.#inside.value === state.key)}
      tabindex=${state.focused && this.#inside.value !== state.key ? 0 : -1}>
      <div class="aster-tile-content" tabindex=${this.#windowed() ? -1 : nothing}
        aria-label=${this.#windowed() ? `Content for ${content.title}` : nothing}>${custom ? custom(t.entity, state) : html`
        <div class="aster-tile-media">
          ${content.icon ?? html`<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="9" y="6" width="30" height="36" rx="4"/><path d="M16 17h16M16 24h16M16 31h10"/></svg>`}
          ${content.image ? html`<img src=${content.image} alt=${content.imageAlt ?? ""} loading="lazy" width="320" height="240"
            @error=${(e: Event) => ((e.target as HTMLImageElement).hidden = true)}
            @load=${(e: Event) => ((e.target as HTMLImageElement).hidden = false)}>` : nothing}
        </div>
        <strong class="aster-tile-title" title=${content.title}>${content.title}</strong>
        ${content.description ? html`<small class="aster-tile-description" aria-hidden="true">${content.description}</small>` : nothing}
      `}</div>
      ${content.description || state.selectionOrder ? html`<span class="aster-sr-only" id=${`${id}-description`}>${content.description ?? ""}
        ${state.selectionOrder ? `Selection ${state.selectionOrder} of ${this.#selection.value!.count.value}.` : ""}</span>` : nothing}
      ${state.selectionOrder ? html`<span class="aster-tile-order" aria-hidden="true">${state.selectionOrder}</span>` : nothing}
      <div class="aster-tile-actions">
        ${this.#windowed() ? html`<button type="button" class="aster-button" tabindex="-1"
          aria-label=${`View content of ${content.title}`} @click=${() => this.#enter(state.key)}>Content</button>` : nothing}
        ${this.#selectable.value && this.#selection.value?.multiple ? html`<button type="button" class="aster-button" tabindex="-1" data-selection-action
          aria-label=${`${state.selected ? "Deselect" : "Select"} ${content.title}`} aria-pressed=${String(state.selected)}
          @click=${() => this.#toggle(state.key)}>${state.selected ? "Deselect" : "Select"}</button>` : nothing}
        ${this.#selectable.value && state.selectionOrder ? html`
          <button type="button" class="aster-button" tabindex="-1" data-selection-action aria-label=${`Move ${content.title} earlier in selection`}
            ?disabled=${state.selectionOrder === 1} @click=${() => this.#move(state.key, -1)}>↑</button>
          <button type="button" class="aster-button" tabindex="-1" data-selection-action aria-label=${`Move ${content.title} later in selection`}
            ?disabled=${state.selectionOrder === this.#selection.value!.count.value} @click=${() => this.#move(state.key, 1)}>↓</button>` : nothing}
        <button type="button" class="aster-button" tabindex="-1" aria-label=${`Open ${content.title}`}
          @click=${() => this.emit<TileOpenDetail>("tile-open", { key: state.key })}>Open</button>
        ${menu.length ? html`<button type="button" class="aster-button" tabindex="-1" aria-haspopup="menu" aria-label=${`Actions for ${content.title}`}
          @click=${(e: MouseEvent) => this.#openMenu(t, menu, e.currentTarget as HTMLElement)}>…</button>` : nothing}
      </div>
    </div>`;
  }

  protected override updated(): void {
    const grid = this.#grid();
    const focusBefore = this.#focusBefore;
    if (!grid) return;
    const slots = this.collection?.keys.peek() ?? [];
    const inside = this.#inside.peek();
    if (inside !== undefined && !slots.includes(inside)) this.#inside.value = undefined;
    const active = grid.querySelector<HTMLElement>('.aster-tile[tabindex="0"]')?.dataset.key;
    if (active !== undefined && active !== this.#active.peek() && !this.#inside.peek()) this.#active.value = active;
    if (!slots.some((key) => key !== undefined)) this.#active.value = undefined;
    if (focusBefore && !focusBefore.isConnected && (document.activeElement === document.body || !document.activeElement)) {
      if (this.#retrying) grid.focus({ preventScroll: true });
      else this.focus({ preventScroll: true });
    }
    if (this.#observed !== grid) {
      this.#resize?.disconnect();
      this.#mutations?.disconnect();
      this.#observed = grid;
      this.#resize = new ResizeObserver(() => this.#measure());
      this.#mutations = new MutationObserver(() => this.#syncControls());
      this.#mutations.observe(grid, { childList: true, subtree: true });
    }
    this.#resize?.disconnect();
    this.#resize?.observe(grid);
    // A track can resize while the outer grid keeps exactly the same dimensions.
    const sample = grid.querySelector(".aster-tile");
    if (sample) this.#resize?.observe(sample);
    this.#measure();
    this.#loadWindow();
    this.#syncControls();
  }

  #measure(): void {
    const grid = this.#grid();
    if (!grid) return;
    const tracks = getComputedStyle(this.#windowed() ? grid.querySelector(".aster-tile-canvas")! : grid).gridTemplateColumns;
    const cols = tracks === "none" ? 1 : tracks.split(" ").filter(Boolean).length;
    const row = grid.querySelector<HTMLElement>(".aster-tile-row");
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    const stride = row ? row.getBoundingClientRect().height + gap : this.#stride.peek();
    const oldCols = this.#columns.peek();
    const oldStride = this.#stride.peek();
    // Reproject the first visible position using CSS's newly measured tracks.
    const oldTop = this.#scroll().logical(grid.scrollTop);
    const anchor = Math.floor(oldTop / oldStride) * oldCols;
    const fraction = oldTop % oldStride / oldStride;
    const style = getComputedStyle(grid);
    const height = grid.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    batch(() => {
      this.#columns.value = cols;
      if (stride > 0) this.#stride.value = stride;
      this.#height.value = height;
      this.#gap.value = gap;
      if (this.#windowed() && (cols !== oldCols || Math.abs(stride - oldStride) > .5)) {
        grid.scrollTop = this.#scroll().physical((Math.floor(anchor / cols) + fraction) * stride);
      }
      this.#top.value = grid.scrollTop;
    });
  }

  #loadWindow(): void {
    const c = this.collection;
    const grid = this.#grid();
    if (!c || !grid || !this.#windowed()) { this.#requested = ""; return; }
    if (c !== this.#bound || c.query !== this.#query) {
      this.#bound = c;
      this.#query = c.query;
      this.#navigation++;
      this.#failedFocus = undefined;
      this.#notice.value = "";
      this.#anchor = undefined;
      this.#anchorPosition = undefined;
      this.#requested = "";
      this.#loading = undefined;
      grid.scrollTop = 0;
      this.#top.value = 0;
    }
    const cols = this.#columns.peek();
    const stride = this.#stride.peek();
    const top = this.#scroll().logical(grid.scrollTop);
    const start = Math.max(0, Math.floor(top / stride) - 2) * cols;
    const end = Math.min(c.count.peek() ?? c.pageSize, (Math.ceil((top + this.#height.peek()) / stride) + 2) * cols);
    const pin = c.keys.peek().indexOf(this.#active.peek() ?? "");
    const pending = this.#pendingFocus.peek();
    const retain = [...(pin < 0 ? [] : [pin]), ...(pending === undefined ? [] : [pending])];
    const request = `${start}:${end}:${pin}:${pending}`;
    if (request === this.#requested || this.#loading) return;
    this.#requested = request;
    const loading = {};
    this.#loading = loading;
    void c.view(start, end, retain).catch(() => {}).finally(() => {
      if (this.#loading !== loading || !this.isConnected) return;
      this.#loading = undefined;
      this.#loadWindow();
    });
  }

  async #retry(): Promise<void> {
    this.#requested = "";
    const index = this.#failedFocus;
    if (index !== undefined) { await this.focusIndex(index); return; }
    const collection = this.collection;
    const grid = this.#grid();
    if (!collection || !grid) return;
    const query = collection.query;
    const request = ++this.#navigation;
    const first = Math.floor(this.#scroll().logical(grid.scrollTop) / this.#stride.peek()) * this.#columns.peek();
    this.#retrying = true;
    this.#loadWindow();
    try {
      await collection.ensure(first, first + this.#columns.peek());
      if (!this.isConnected || request !== this.#navigation || collection.query !== query) return;
      const key = collection.keys.peek()[first];
      if (key === undefined) return;
      this.#active.value = key;
      this.#inside.value = undefined;
      queueMicrotask(() => this.tileFor(key)?.focus({ preventScroll: true }));
    } catch {
      // The collection supplies the reachable retry and failure state.
    } finally {
      this.#retrying = false;
    }
  }

  #syncControls(): void {
    for (const tile of this.querySelectorAll<HTMLElement>(".aster-tile")) {
      const inside = tile.dataset.key === this.#inside.peek();
      const content = tile.querySelector<HTMLElement>(".aster-tile-content");
      if (content && this.#windowed()) {
        const overflow = content.scrollHeight > content.clientHeight + 1;
        this.#tabStops.set(content, overflow ? "0" : "-1");
      }
      for (const control of tile.querySelectorAll<HTMLElement>(CONTROLS)) {
        if (!this.#tabStops.has(control)) this.#tabStops.set(control, control.getAttribute("tabindex"));
        if (inside) {
          const original = this.#tabStops.get(control);
          // The shell's action buttons participate when interaction mode is entered.
          if (original === null || control.closest(".aster-tile-actions")) control.removeAttribute("tabindex");
          else control.setAttribute("tabindex", original!);
        } else control.setAttribute("tabindex", "-1");
      }
    }
  }

  #focusIn(e: FocusEvent): void {
    const tile = this.#tileOf(e);
    if (!tile) return;
    if (tile.dataset.key !== this.#active.peek()) {
      this.#navigation++;
      this.#failedFocus = undefined;
    }
    this.#active.value = tile.dataset.key;
    if (e.target !== tile) this.#inside.value = tile.dataset.key;
    else this.#inside.value = undefined;
    if (this.#windowed() && tile.parentElement?.dataset.pinned === "true") {
      const index = this.collection!.keys.peek().indexOf(tile.dataset.key!);
      if (index >= 0) this.#reveal(index);
    }
  }

  #keys(): KeyText[] { return (this.collection?.keys.peek() ?? []).filter((key): key is KeyText => key !== undefined); }
  #grid(): HTMLElement | undefined { return this.querySelector<HTMLElement>(".aster-tile-grid") ?? undefined; }
  #tileId(key: KeyText): string {
    return `${this.#id}-${Array.from(key, (c) => c.codePointAt(0)!.toString(16)).join("-")}`;
  }
  #tileOf(e: Event): HTMLElement | undefined {
    const tile = (e.target as Element).closest<HTMLElement>(".aster-tile");
    return tile?.dataset.key !== undefined && tile.closest("aster-tile-grid") === this ? tile : undefined;
  }
  #interactive(e: Event): boolean {
    const tile = this.#tileOf(e);
    const control = (e.target as Element).closest(CONTROLS);
    if (control?.classList.contains("aster-tile-content")) return e.type === "keydown" && e.target === control;
    return !!tile && !!control && control !== tile;
  }
  #choose(key: KeyText, extend: boolean, toggle: boolean): void {
    if (!this.#selectable.peek()) return;
    const selection = this.#selection.peek();
    if (!selection) return;
    if (extend && selection.multiple) {
      const slots = this.collection!.keys.peek();
      const anchor = this.#anchor ?? this.#active.peek() ?? key;
      const loaded = slots.indexOf(anchor);
      const a = loaded >= 0 ? loaded : this.#anchorQuery === this.collection!.query ? this.#anchorPosition ?? 0 : 0;
      const b = slots.indexOf(key);
      const range = slots.slice(Math.min(a, b), Math.max(a, b) + 1).filter((k): k is KeyText => k !== undefined);
      this.#selectionResult(selection.selectAll(range));
    } else {
      if (toggle || selection.ordered) this.#toggle(key);
      else selection.select(key);
      this.#anchor = key;
      this.#anchorPosition = this.collection!.keys.peek().indexOf(key);
      this.#anchorQuery = this.collection!.query;
    }
  }
  #selectionResult(accepted: boolean): void {
    this.#notice.value = accepted ? "" : `Select at most ${this.#selection.peek()?.maxOrdered} ordered items. Deselect an item to add another.`;
  }
  #toggle(key: KeyText): void {
    if (!this.#selectable.peek()) return;
    const selection = this.#selection.peek();
    if (selection) this.#selectionResult(selection.toggle(key));
  }
  #move(key: KeyText, delta: number): void {
    if (!this.#selectable.peek()) return;
    const selection = this.#selection.peek();
    if (!selection) return;
    const index = selection.keys.peek().indexOf(key) + delta;
    if (selection.move(key, index)) this.#notice.value = `Moved to selection position ${index + 1}.`;
  }
  #enter(key: KeyText): void {
    this.#inside.value = key;
    queueMicrotask(() => {
      this.#syncControls();
      [...(this.tileFor(key)?.querySelectorAll<HTMLElement>(CONTROLS) ?? [])]
        .find((el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length)?.focus();
    });
  }
  #click(e: MouseEvent): void {
    if (this.#interactive(e)) return;
    const tile = this.#tileOf(e);
    const text = getSelection();
    if (!tile || (text && !text.isCollapsed && tile.contains(text.anchorNode))) return;
    const key = tile.dataset.key!;
    this.#choose(key, e.shiftKey, e.ctrlKey || e.metaKey);
    this.focusTile(key);
  }
  #doubleClick(e: MouseEvent): void {
    if (this.#interactive(e)) return;
    const tile = this.#tileOf(e);
    if (tile) this.emit<TileOpenDetail>("tile-open", { key: tile.dataset.key! });
  }
  #context(e: MouseEvent, tiles: readonly Tile[]): void {
    if (this.#interactive(e)) return;
    const tile = this.#tileOf(e);
    const t = tiles.find((t) => t.state.key === tile?.dataset.key);
    const items = t ? this.#actions.peek()?.(t.entity, t.state) : undefined;
    if (!t || !items?.length || !tile) return;
    e.preventDefault();
    this.#active.value = t.state.key;
    tile.focus({ preventScroll: true });
    this.#openMenu(t, items, tile, { x: e.clientX, y: e.clientY });
  }
  #openMenu(t: Tile, items: readonly MenuItem[], opener: HTMLElement, point?: { x: number; y: number }): void {
    this.#menu ??= new Menu();
    if (!this.#menu.isConnected) this.append(this.#menu);
    const rect = opener.getBoundingClientRect();
    this.#menu.openAt(point ?? { x: rect.left, y: rect.bottom }, items, `Actions for ${t.content.title}`, opener);
  }
  #key(e: KeyboardEvent, tiles: readonly Tile[], cols: number): void {
    const key = this.#tileOf(e)?.dataset.key ?? this.#active.peek();
    const tileIndex = tiles.findIndex((t) => t.state.key === key);
    const index = this.#windowed() ? tiles[tileIndex]?.state.index ?? -1 : tileIndex;
    if (index < 0) return;
    if (e.key === "Escape" && this.#inside.peek()) {
      e.preventDefault(); e.stopPropagation(); this.focusTile(key!); return;
    }
    if (this.#interactive(e)) {
      if (e.key === "Tab") {
        const controls = this.tileFor(key)!.querySelectorAll<HTMLElement>(CONTROLS);
        const enabled = [...controls].filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length);
        if (e.shiftKey && e.target === enabled[0]) { e.preventDefault(); this.focusTile(key!); }
        else if (!e.shiftKey && e.target === enabled.at(-1)) { this.#inside.value = undefined; }
      }
      return;
    }
    const t = tiles[tileIndex]!;
    if (e.altKey && this.#selection.peek()?.ordered && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault(); this.#move(key!, e.key === "ArrowUp" ? -1 : 1); return;
    }
    const total = this.#windowed() ? this.collection!.count.peek() ?? tiles.length : tiles.length;
    const rtl = getComputedStyle(this.#grid()!).direction === "rtl";
    const keys = this.#windowed() ? this.#keys() : tiles.map((t) => t.state.key);
    let next: number | undefined;
    switch (e.key) {
      case "ArrowRight": next = index + (rtl ? -1 : 1); break;
      case "ArrowLeft": next = index + (rtl ? 1 : -1); break;
      case "ArrowDown": next = Math.min(total - 1, index + cols); break;
      case "ArrowUp": next = index - cols; break;
      case "PageDown":
      case "PageUp": {
        const height = this.tileFor(key)?.getBoundingClientRect().height ?? 1;
        const page = Math.max(1, Math.floor((this.#windowed() ? this.#grid()!.clientHeight : window.innerHeight) / height)) * cols;
        next = Math.max(0, Math.min(total - 1, index + (e.key === "PageDown" ? page : -page)));
        break;
      }
      case "Home": next = e.ctrlKey ? 0 : Math.floor(index / cols) * cols; break;
      case "End": next = e.ctrlKey ? total - 1 : Math.min(total - 1, (Math.floor(index / cols) + 1) * cols - 1); break;
      case " ": this.#choose(key!, e.shiftKey, this.#selection.peek()?.multiple ?? false); break;
      case "Enter": this.emit<TileOpenDetail>("tile-open", { key: key! }); break;
      case "F2":
        this.#enter(key!);
        break;
      case "ContextMenu":
      case "F10": {
        if (e.key === "F10" && !e.shiftKey) return;
        const items = this.#actions.peek()?.(t.entity, t.state) ?? [];
        if (items.length) this.#openMenu(t, items, this.tileFor(key)!);
        break;
      }
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        const now = performance.now();
        this.#search = now - this.#searchedAt > 700 ? e.key : this.#search + e.key;
        this.#searchedAt = now;
        const search = this.#search.toLocaleLowerCase();
        const candidates = this.#windowed() ? this.collection!.keys.peek().flatMap((key, i) => {
          if (key === undefined) return [];
          const tile = this.#tileAt(i, this.#active.peek(), this.#selection.peek()?.keys.peek() ?? []);
          return tile ? [tile] : [];
        }) : tiles;
        let match = candidates.find((tile) => tile.state.index > t.state.index && tile.content.title.toLocaleLowerCase().startsWith(search));
        match ??= candidates.find((tile) => tile.content.title.toLocaleLowerCase().startsWith(search));
        next = match ? this.#windowed() ? match.state.index : tiles.indexOf(match) : -1;
      }
    }
    e.preventDefault();
    if (next === undefined || next < 0 || next >= total) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (Math.floor(next / cols) !== Math.floor(index / cols)) return;
    }
    if (this.#windowed()) {
      const anchor = this.#anchor ?? key;
      void this.focusIndex(next).then((focused) => {
        if (!focused || !e.shiftKey) return;
        this.#anchor = anchor;
        // Range selection is restricted to keys loaded when navigation completes.
        this.#choose(this.#active.peek()!, true, false);
      });
    } else {
      if (e.shiftKey) this.#choose(keys[next]!, true, false);
      this.focusTile(keys[next]!);
    }
  }
}

define("aster-tile-grid", TileGrid);
