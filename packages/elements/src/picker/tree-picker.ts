import { signal } from "@preact/signals-core";
import { keyFromText, keyText, type Field as FieldMeta, type KeyText, type Tree, type TreeRow, type Value } from "@getaster/data";
import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext } from "../field/bound-field.ts";
import { anchorStyle, openWhen, placeStyle } from "../overlay/anchor.ts";
import { TreeChoices } from "./tree-choices.ts";

const SEARCH_DELAY = 200;

/**
 * A combobox whose popup is a tree (APG editable combobox, `aria-haspopup`
 * tree): for choosing one node of a hierarchy where names repeat across
 * branches. The closed control shows the chosen node's name with its path
 * under it. Opening reveals the chosen node; typing filters the tree to the
 * matches and the folders leading to them.
 *
 * Keyboard: ↓/↑ open and move, Home/End go to the first and last row, → opens
 * a folder or moves into it, ← closes it or moves to its parent, Enter
 * chooses (or opens a folder that can't be chosen), Escape closes and
 * restores the text. ←/→ move the caret instead until ↓/↑ have moved in the
 * tree since the last typing. Focus stays in the input; the active row is
 * its `aria-activedescendant`.
 */
export class TreePicker extends BoundField {
  readonly #options = this.prop<TreeChoices | undefined>(undefined);
  readonly #placeholder = this.prop("");
  readonly #open = this.prop(false);
  readonly #query = this.prop<string | undefined>(undefined);
  readonly #active = this.prop<KeyText | undefined>(undefined);
  /** The typed text the tree's filter follows, after a pause. */
  readonly #search = signal("");
  readonly #tree = this.prop<Tree | undefined>(undefined);
  #treeFor: TreeChoices | undefined;
  #navigating = false;
  #searchTimer: ReturnType<typeof setTimeout> | undefined;

  get options(): TreeChoices | undefined {
    return this.#options.value;
  }
  set options(v: TreeChoices | undefined) {
    this.#options.value = v;
  }
  get placeholder(): string {
    return this.#placeholder.value;
  }
  set placeholder(v: string) {
    this.#placeholder.value = v;
  }

  override focus(options?: FocusOptions): void {
    this.querySelector("input")?.focus(options);
  }

  override disconnectedCallback(): void {
    this.#close();
    this.#tree.peek()?.dispose();
    this.#tree.value = undefined;
    this.#treeFor = undefined;
    super.disconnectedCallback();
  }

  protected override describe(_meta: FieldMeta | undefined, value: Value | undefined): string {
    const source = this.#options.peek();
    const record = source?.record(value ?? null)?.value;
    if (!source || !record) return value === null || value === undefined ? "" : String(value);
    const trail = source.trail(record);
    return trail.length ? `${source.text(record)} in ${trail.join(", ")}` : source.text(record);
  }

  protected control(c: ControlContext): View {
    const source = this.#options.value;
    const open = this.#open.value && !c.state.readOnly;
    const query = this.#query.value;
    const current = source?.record(c.value ?? null)?.value;
    const label = current && source ? source.text(current) : c.value === null || c.value === undefined ? "" : String(c.value);
    const trail = current && source ? source.trail(current) : [];
    const tree = open ? this.#tree.value : undefined;
    const rows = tree?.rows.value ?? [];
    const activeKey = this.#active.value;
    const typed = query?.trim() ?? "";
    // Until a row is made active, the first match that can be chosen is.
    const first = (r: TreeRow) => {
      const e = r.key === undefined ? undefined : tree?.entity(r.key);
      return e !== undefined && source!.canChoose(e) && (!typed || source!.matches(e, typed));
    };
    const active = activeKey === undefined ? rows.findIndex(first) : rows.findIndex((r) => r.key === activeKey);
    const treeId = `${c.id}-tree`;
    const rowId = (key: KeyText) => `${c.id}-node-${encodeURIComponent(key)}`;
    const trailId = `${c.id}-trail`;
    const describedBy = [c.describedBy, trail.length ? trailId : ""].filter(Boolean).join(" ") || undefined;
    const activeRow = active < 0 ? undefined : rows[active];

    const moveTo = (i: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!row?.key) return;
      this.#active.value = row.key;
      this.#navigating = true;
      requestAnimationFrame(() => this.querySelector(`#${CSS.escape(rowId(row.key!))}`)?.scrollIntoView({ block: "nearest" }));
    };
    const choose = (row: TreeRow | undefined) => {
      if (!row?.key || !source || !tree) return;
      const entity = tree.entity(row.key);
      if (!entity) return;
      if (!source.canChoose(entity)) {
        if (row.folder !== false) void tree.toggle(row.key);
        return;
      }
      this.write(keyFromText(row.key)[0] ?? null);
      this.#close();
    };
    const status = !tree
      ? ""
      : tree.tooBroad.value
        ? "Too many matches; type more."
        : tree.searching.value || this.#search.value.trim() !== typed
          ? "Searching…"
          : typed && rows.length === 0
            ? `Nothing matches “${typed}”.`
            : "";

    return html`<div class="aster-picker aster-tree-picker">
      <label class="aster-field" data-ring-owner style=${anchorStyle(c.id)}>
        <input id=${c.id} role="combobox" .value=${live(query ?? label)}
          aria-label=${this.labelled ? nothing : c.label}
          placeholder=${this.#placeholder.value || (c.meta?.nullable ? "None" : "Choose…")}
          aria-haspopup="tree" aria-expanded=${open ? "true" : "false"} aria-controls=${treeId} aria-autocomplete="list"
          aria-activedescendant=${open && activeRow?.key ? rowId(activeRow.key) : nothing}
          aria-required=${c.state.required ? "true" : nothing}
          aria-invalid=${c.invalid ? "true" : nothing}
          aria-describedby=${describedBy ?? nothing}
          ?readonly=${c.state.readOnly}
          autocomplete="off" spellcheck="false"
          @input=${(e: InputEvent) => this.#type((e.target as HTMLInputElement).value)}
          @click=${(e: MouseEvent) => {
            if (this.#open.peek()) return this.#close();
            this.#show();
            (e.target as HTMLInputElement).select();
          }}
          @focus=${(e: FocusEvent) => (e.target as HTMLInputElement).select()}
          @blur=${(e: FocusEvent) => {
            if (this.contains(e.relatedTarget as Node)) return;
            this.#close();
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (c.state.readOnly) return;
            const isOpen = this.#open.peek();
            switch (e.key) {
              case "ArrowDown":
              case "ArrowUp":
                e.preventDefault();
                if (!isOpen) return this.#show();
                return moveTo(active < 0 ? 0 : active + (e.key === "ArrowDown" ? 1 : -1));
              case "Home":
              case "End":
                if (!isOpen || !this.#navigating) return;
                e.preventDefault();
                return moveTo(e.key === "Home" ? 0 : rows.length - 1);
              case "ArrowRight":
                if (!isOpen || !this.#navigating || !activeRow?.key || !tree || !activeRow.folder) return;
                e.preventDefault();
                if (!activeRow.open) return void tree.expand(activeRow.key);
                return moveTo(active + 1);
              case "ArrowLeft": {
                if (!isOpen || !this.#navigating || !activeRow?.key || !tree) return;
                e.preventDefault();
                if (activeRow.open) return tree.collapse(activeRow.key);
                const parent = rows.findIndex((r) => r.key === activeRow.parent);
                return parent >= 0 ? moveTo(parent) : undefined;
              }
              case "Enter":
                if (!isOpen) return;
                e.preventDefault();
                return choose(activeRow);
              case "Escape":
                if (!isOpen) return;
                e.preventDefault();
                e.stopPropagation();
                return this.#close();
            }
          }}>
        <svg class="aster-picker-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.8 5 6.8l3-3"/></svg>
      </label>
      ${trail.length
        ? html`<p class="aster-tree-picker-trail" id=${trailId}><span class="aster-sr-only">In </span>${trail.map(
            (name, i) => html`${i ? html`<span aria-hidden="true"> › </span><span class="aster-sr-only">, </span>` : nothing}${name}`,
          )}</p>`
        : nothing}
      <div class="aster-picker-list aster-popover aster-tree-picker-list" popover="manual" ${openWhen(open)} style=${placeStyle(c.id)}
        id=${treeId} role="tree" aria-label=${c.label} aria-busy=${status === "Searching…" ? "true" : nothing}>
        ${rows.map((row, i) => this.#row(row, i === active, c.value, typed, rowId, choose))}
        ${status || (tree && rows.length === 0) ? html`<div class="aster-picker-empty" role="none">${status || "No choices."}</div>` : nothing}
      </div>
      <div class="aster-sr-only" role="status">${open && status !== "Searching…" ? status : ""}</div>
    </div>`;
  }

  #row(row: TreeRow, active: boolean, chosen: Value | undefined, typed: string, rowId: (key: KeyText) => string, choose: (row: TreeRow) => void): View {
    const source = this.#options.peek()!;
    const tree = this.#tree.peek()!;
    const indent = `--level: ${row.level}`;
    if (!row.key) {
      // A row not loaded yet: ask for its page.
      queueMicrotask(() => void row.collection.ensure(row.index, row.index + row.collection.pageSize).catch(() => {}));
      return html`<div class="aster-tree-option" role="none" style=${indent}><span class="aster-tree-option-twisty"></span>Loading…</div>`;
    }
    const key = row.key;
    const entity = tree.entity(key);
    const can = entity ? source.canChoose(entity) : false;
    const selected = chosen !== null && chosen !== undefined && keyText([chosen]) === key;
    const toggle = (e: MouseEvent) => {
      e.stopPropagation();
      void tree.toggle(key);
    };
    return html`<div class="aster-tree-option" role="treeitem" id=${rowId(key)} style=${indent}
      aria-level=${row.level} aria-posinset=${row.position} aria-setsize=${row.siblings}
      aria-expanded=${row.folder === false || (row.folder === undefined && can) ? nothing : row.open ? "true" : "false"}
      aria-selected=${selected ? "true" : "false"}
      ?data-active=${active} ?data-group=${!can} ?data-context=${typed !== "" && entity !== undefined && !source.matches(entity, typed)}
      @pointerdown=${(e: PointerEvent) => e.preventDefault()}
      @click=${() => {
        this.#active.value = key;
        choose(row);
      }}>
      <span class="aster-tree-option-twisty" @click=${row.folder === false ? nothing : toggle}>
        ${row.folder === false || (row.folder === undefined && can) ? nothing : html`<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.8 2 6.8 5l-3 3"/></svg>`}
      </span>${entity ? source.text(entity) : ""}
    </div>`;
  }

  #ensureTree(): Tree | undefined {
    const source = this.#options.peek();
    if (!source) return undefined;
    if (this.#treeFor !== source) {
      this.#tree.peek()?.dispose();
      this.#tree.value = source.tree(this.#search);
      this.#treeFor = source;
    }
    return this.#tree.peek();
  }

  #show(): void {
    if (this.#open.peek()) return;
    const tree = this.#ensureTree();
    if (!tree) return;
    this.#open.value = true;
    this.#navigating = false;
    const value = this.model?.values.peek()[this.field];
    if (value === null || value === undefined) {
      this.#active.value = undefined;
      return;
    }
    const key = keyText([value]);
    this.#active.value = key;
    void tree.reveal(key).then(() => {
      if (this.#active.peek() === key) this.querySelector(`[aria-selected="true"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  #type(text: string): void {
    this.#query.value = text;
    this.#active.value = undefined;
    this.#navigating = false;
    this.#show();
    clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(() => (this.#search.value = text.trim()), SEARCH_DELAY);
  }

  #close(): void {
    clearTimeout(this.#searchTimer);
    this.#open.value = false;
    this.#query.value = undefined;
    this.#search.value = "";
    this.#navigating = false;
  }
}

define("aster-tree-picker", TreePicker);
