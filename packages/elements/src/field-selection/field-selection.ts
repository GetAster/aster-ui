import "../select/choice-element.ts";
import { validateFieldSelectionChrome } from "./config.ts";
import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { AsterElement, define, each, uid, type View } from "../base/element.ts";
import { FieldSelectionModel, type FieldSelectionFilter, type FieldSelectionPolicy, type FieldSelectionSource } from "./model.ts";

export class FieldSelection extends AsterElement {
  readonly #model = this.prop(new FieldSelectionModel());
  readonly #chrome = this.prop<Readonly<{ selected?: boolean }>>({});
  readonly #active = this.prop<string | undefined>(undefined);
  readonly #label = this.prop("Fields");
  readonly #id = uid("aster-field-selection");

  get model(): FieldSelectionModel { return this.#model.value; }
  set model(value: FieldSelectionModel) { this.#model.value = value; }
  get source(): FieldSelectionSource | undefined { return this.model.source; }
  set source(value: FieldSelectionSource | undefined) { this.model.source = value; }
  get value(): readonly string[] { return this.model.value; }
  set value(value: readonly string[]) { this.model.value = value; }
  get filter(): FieldSelectionFilter { return this.model.filter; }
  set filter(value: FieldSelectionFilter) { this.model.filter = value; }
  get search(): string { return this.model.search; }
  set search(value: string) { this.model.search = value; }
  get maxDepth(): number { return this.model.maxDepth; }
  set maxDepth(value: number) { this.model.maxDepth = value; }
  get policy(): Readonly<Record<string, FieldSelectionPolicy>> { return this.model.policy; }
  set policy(value: Readonly<Record<string, FieldSelectionPolicy>>) { this.model.policy = value; }
  get chrome(): Readonly<{ selected?: boolean }> { return this.#chrome.value; }
  set chrome(value: Readonly<{ selected?: boolean }>) { this.#chrome.value = validateFieldSelectionChrome(value); }
  get label(): string { return this.#label.value; }
  set label(value: string) { this.#label.value = value; }

  override focus(options?: FocusOptions): void { this.querySelector<HTMLInputElement>('input[type="search"]')?.focus(options); }

  protected render(): View {
    const model = this.model;
    const label = this.label;
    const selected = model.value;
    const rows = model.rows;
    const active = rows.find(row => row.path === this.#active.value) ?? [...rows].reverse().find(row => this.#active.value?.startsWith(`${row.path}/`) && row.branch) ?? rows[0];
    const rowId = (path: string) => `${this.#id}-row-${encodeURIComponent(path)}`;
    const byPath = new Map(rows.map(row => [row.path, row]));
    const parent = (path: string) => {
      const slash = path.lastIndexOf("/");
      const row = slash < 0 ? undefined : byPath.get(path.slice(0, slash));
      return row?.branch ? row : undefined;
    };
    const groups = new Map<string, typeof rows[number][]>();
    for (const row of rows) {
      const key = parent(row.path)?.path ?? "";
      const siblings = groups.get(key) ?? [];
      siblings.push(row); groups.set(key, siblings);
    }
    const positions = new Map<string, { index: number; size: number }>();
    for (const siblings of groups.values()) siblings.forEach((row, index) => positions.set(row.path, { index: index + 1, size: siblings.length }));
    const moveTo = (index: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
      if (!row) return;
      this.#active.value = row.path;
      queueMicrotask(() => document.getElementById(rowId(row.path))?.scrollIntoView({ block: "nearest" }));
    };
    const reasonId = (path: string, action: string) => `${this.#id}-${action}-${encodeURIComponent(path)}`;
    const notify = (changed: boolean) => {
      if (!changed) return;
      const focused = document.activeElement;
      this.emit("value-change", model.change, { cancelable: false });
      queueMicrotask(() => {
        if (focused instanceof HTMLElement && (!focused.isConnected || focused.matches(":disabled"))) this.focus();
      });
    };
    return html`<section class="aster-field-selection" aria-labelledby=${`${this.#id}-title`}>
      <h3 id=${`${this.#id}-title`}>${label}</h3>
      <div class="aster-field-selection-tools">
        <label>Search fields<input type="search" .value=${live(model.search)}
          @input=${(event: Event) => { model.search = (event.target as HTMLInputElement).value; }}></label>
        <div class="aster-field-selection-filter"><span>Show</span><aster-choice .label=${"Show"} .value=${model.filter}
          .options=${[{ value: "all", label: "All fields" }, { value: "direct", label: "Direct fields" }, { value: "related", label: "Related fields" }]}
          @change=${(event: CustomEvent<FieldSelectionFilter>) => { event.stopPropagation(); model.filter = event.detail; }}></aster-choice></div>
      </div>
      <p class="aster-field-selection-hint">Expand relationships to find their fields. Search includes expanded relationships.</p>
      ${this.chrome.selected !== false ? html`<div role="group" aria-labelledby=${`${this.#id}-selected`}>
        <h4 id=${`${this.#id}-selected`}>Selected fields (${selected.length})</h4>
        <ol class="aster-field-selection-selected">
          ${each(model.selected, (field) => field.path, (field) => {
            const hide = model.selectionReason(field.path);
            const up = model.moveReason(field.path, -1);
            const down = model.moveReason(field.path, 1);
            const move = model.policy[field.path]?.move;
            return html`<li data-path=${field.path}>
              <span class="aster-field-selection-name">${field.label}</span>
              <div class="aster-field-selection-actions">
                <button type="button" aria-label=${`Move ${field.label} up`} ?disabled=${up !== undefined} title=${up ?? nothing}
                  aria-describedby=${move !== undefined ? reasonId(field.path, "move") : nothing}
                  @click=${() => notify(model.move(field.path, -1))}>↑</button>
                <button type="button" aria-label=${`Move ${field.label} down`} ?disabled=${down !== undefined} title=${down ?? nothing}
                  aria-describedby=${move !== undefined ? reasonId(field.path, "move") : nothing}
                  @click=${() => notify(model.move(field.path, 1))}>↓</button>
                <button type="button" aria-label=${`Remove ${field.label}`} ?disabled=${hide !== undefined} title=${hide ?? nothing}
                  aria-describedby=${hide !== undefined ? reasonId(field.path, "hide") : nothing}
                  @click=${() => notify(model.select(field.path, false))}>Remove</button>
              </div>
              ${hide !== undefined ? html`<small id=${reasonId(field.path, "hide")}>${hide}</small>` : nothing}
              ${move !== undefined ? html`<small id=${reasonId(field.path, "move")}>${move}</small>` : nothing}
            </li>`;
          })}
        </ol>
        ${selected.length ? nothing : html`<p class="aster-field-selection-hint">No fields selected.</p>`}
      </div>
      ` : nothing}
      <div role="group" aria-labelledby=${`${this.#id}-available`}>
        <h4 id=${`${this.#id}-available`}>${this.chrome.selected === false ? "Fields" : "Available fields"}</h4>
        <ul class="aster-field-selection-available" role="tree" tabindex=${rows.length ? 0 : -1} aria-labelledby=${`${this.#id}-available`}
          aria-multiselectable="true" aria-activedescendant=${active ? rowId(active.path) : nothing}
          @keydown=${(event: KeyboardEvent) => {
            if (!active || event.altKey || event.ctrlKey || event.metaKey) return;
            this.#active.value = active.path;
            const index = rows.indexOf(active);
            switch (event.key) {
              case "ArrowDown": event.preventDefault(); moveTo(index + 1); break;
              case "ArrowUp": event.preventDefault(); moveTo(index - 1); break;
              case "Home": event.preventDefault(); moveTo(0); break;
              case "End": event.preventDefault(); moveTo(rows.length - 1); break;
              case "ArrowRight":
                event.preventDefault();
                if (active.branch && !active.reason) {
                  if (!active.expanded) model.toggle(active.path);
                  else if (parent(rows[index + 1]?.path ?? "")?.path === active.path) moveTo(index + 1);
                }
                break;
              case "ArrowLeft": {
                event.preventDefault();
                if (active.branch && active.expanded) model.toggle(active.path);
                else { const ancestor = parent(active.path); if (ancestor) moveTo(rows.indexOf(ancestor)); }
                break;
              }
              case " ":
                event.preventDefault();
                if (!active.branch) notify(model.select(active.path, !selected.includes(active.path)));
                break;
              case "Enter":
                if (active.branch && !active.reason) { event.preventDefault(); model.toggle(active.path); }
                break;
            }
          }}>
          ${each(rows, (row) => row.path, (row) => {
            const reason = row.branch ? row.reason : model.selectionReason(row.path);
            const position = positions.get(row.path)!;
            return html`<li data-path=${row.path} id=${rowId(row.path)} role="treeitem"
              aria-level=${row.depth + 1} aria-posinset=${position.index} aria-setsize=${position.size}
              aria-expanded=${row.branch ? String(row.expanded) : nothing}
              aria-checked=${row.branch ? nothing : String(selected.includes(row.path))}
              aria-disabled=${reason !== undefined ? "true" : nothing}
              aria-label=${row.branch && row.selectedCount ? `${row.label}, ${row.selectedCount} selected` : row.label} title=${row.label} ?data-active=${active?.path === row.path}
              aria-describedby=${reason !== undefined ? reasonId(row.path, "available") : nothing}
              style=${`--aster-field-depth: ${row.depth}`}
              @pointerdown=${(event: PointerEvent) => { event.preventDefault(); this.querySelector<HTMLElement>('[role="tree"]')?.focus({ preventScroll: true }); }}
              @click=${(event: MouseEvent) => {
                this.#active.value = row.path;
                if (row.branch) { if (!reason) model.toggle(row.path); }
                else if (!(event.target instanceof Element && event.target.closest("label"))) notify(model.select(row.path, !selected.includes(row.path)));
              }}>
              ${row.branch ? html`<span class="aster-field-selection-branch">
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.8 2 6.8 5l-3 3"/></svg>
                <span class="aster-field-selection-name">${row.localLabel}</span>
                <span class="aster-field-selection-hint">${row.collection ? "To many" : "To one"}</span>
                ${row.selectedCount ? html`<span class="aster-field-selection-count">${row.selectedCount} selected</span>` : nothing}
              </span>` : html`<label><input type="checkbox" tabindex="-1" aria-hidden="true" aria-label=${row.label}
                  .checked=${selected.includes(row.path)} ?disabled=${reason !== undefined}
                  @change=${(event: Event) => {
                    const checked = (event.target as HTMLInputElement).checked;
                    this.querySelector<HTMLElement>('[role="tree"]')?.focus({ preventScroll: true });
                    notify(model.select(row.path, checked));
                  }}>
                ${row.localLabel}</label>`}
              ${reason !== undefined ? html`<small id=${reasonId(row.path, "available")}>${reason}</small>` : nothing}
            </li>`;
          })}
        </ul>
        ${rows.length ? nothing : html`<p class="aster-field-selection-hint">No available fields match.</p>`}
      </div>
    </section>`;
  }
}

define("aster-field-selection", FieldSelection);

declare global {
  interface HTMLElementTagNameMap {
    "aster-field-selection": FieldSelection;
  }
}
