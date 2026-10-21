import { signal } from "@preact/signals-core";
import { EditModel, type Collection, type Entity, type Field as FieldMeta, type Value } from "@getaster/data";
import { html, nothing, type TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext } from "../field/bound-field.ts";
import "../field/field.ts";
import { anchorStyle, openWhen, placeStyle } from "../overlay/anchor.ts";
import "../select/select.ts";
import { PickerOptions } from "./options.ts";

const SEARCH_DELAY = 200;
const COUNT = new Intl.NumberFormat("en-GB");

/** One entry of the open list: an option, or "Create …" at the end. */
type Entry = { readonly kind: "option"; readonly entity: Entity } | { readonly kind: "create"; readonly text: string };

/**
 * A combobox over related records (APG editable combobox with list
 * autocomplete). It shows the record's display field and offers the
 * options, filtered as you type: on the server when there are more than a
 * page of them, with the match count announced.
 *
 * With `PickerOptions` it also has columns with a header, headings by a
 * group field, options that follow the page scope (a value they no longer
 * include stays, and the field says so), and "Create …", a small form that
 * selects what it created. `multiple` holds several values as chips and
 * reports them by `change`; it isn't bound to a model.
 *
 * Keyboard: ↓/↑ open and move, Page Down/Up move further, Home/End go to
 * the first and last option, Enter chooses, Escape closes and restores the
 * text, Tab leaves without choosing; with chips, Backspace in the empty
 * input removes the last. The active option is the input's
 * `aria-activedescendant`, so focus stays in the input.
 */
export class Picker extends BoundField {
  readonly #options = this.prop<Collection | PickerOptions | undefined>(undefined);
  readonly #display = this.prop("");
  readonly #valueField = this.prop("");
  readonly #multiple = this.prop(false);
  readonly #values = this.prop<readonly Value[]>([]);
  readonly #placeholder = this.prop("");
  readonly #open = this.prop(false);
  readonly #query = this.prop<string | undefined>(undefined);
  readonly #active = this.prop(0);
  readonly #creating = this.prop<EditModel | undefined>(undefined);
  /** The typed text a server search follows, after a pause. */
  readonly #search = signal("");
  #searchTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #searching = this.prop<Collection | undefined>(undefined);

  get options(): Collection | PickerOptions | undefined {
    return this.#options.value;
  }
  set options(v: Collection | PickerOptions | undefined) {
    this.#options.value = v;
  }
  /** The field of an option shown as its text (with a plain collection). */
  get display(): string {
    return this.#display.value;
  }
  set display(v: string) {
    this.#display.value = v;
  }
  get valueField(): string {
    return this.#valueField.value;
  }
  set valueField(v: string) {
    this.#valueField.value = v;
  }
  get multiple(): boolean {
    return this.#multiple.value;
  }
  set multiple(v: boolean) {
    this.#multiple.value = v;
  }
  /** The chosen values when `multiple`. */
  get values(): readonly Value[] {
    return this.#values.value;
  }
  set values(v: readonly Value[]) {
    this.#values.value = v;
  }
  get placeholder(): string {
    return this.#placeholder.value;
  }
  set placeholder(v: string) {
    this.#placeholder.value = v;
  }

  protected override describe(_meta: FieldMeta | undefined, value: Value | undefined): string {
    if (value === null || value === undefined) return "";
    const record = this.#record(value);
    return record ? this.#text(record) : String(value);
  }

  override focus(options?: FocusOptions): void {
    this.querySelector("input")?.focus(options);
  }

  override disconnectedCallback(): void {
    this.#endSearch();
    super.disconnectedCallback();
  }

  protected control(c: ControlContext): View {
    const source = this.#source();
    const key = this.#key();
    const multiple = this.#multiple.value;
    const chosen = multiple ? this.#values.value : c.value === null || c.value === undefined ? [] : [c.value];
    const query = this.#query.value;
    const open = this.#open.value && !c.state.readOnly;
    const list = this.#list();
    const loaded = (list?.items.value ?? []).filter((e): e is Entity => e !== undefined);
    const searching = this.#searching.value;
    const local = !searching;
    const typed = query?.trim().toLowerCase() ?? "";
    // A large set answers typed text from the server; until it has, there's nothing to show or count.
    const waiting =
      typed !== "" && source !== undefined && !source.small &&
      (!searching || this.#search.value.trim().toLowerCase() !== typed || searching.count.value === undefined);
    const shown = waiting ? [] : local && typed ? loaded.filter((e) => this.#searchText(e).includes(typed)) : loaded;
    const total = waiting ? undefined : local ? (typed || !list ? shown.length : (list.count.value ?? shown.length)) : list?.count.value;
    const createText = source?.spec.create && query?.trim() && !waiting ? query.trim() : undefined;
    const entries: Entry[] = [
      ...shown.map((entity): Entry => ({ kind: "option", entity })),
      ...(createText ? [{ kind: "create", text: createText } as const] : []),
    ];
    const active = Math.min(this.#active.value, Math.max(0, entries.length - 1));
    const listId = `${c.id}-options`;
    const optionId = (i: number) => `${c.id}-option-${i}`;
    const current = !multiple && chosen.length ? this.#record(chosen[0]) : undefined;
    const label = multiple ? "" : current ? this.#text(current) : chosen.length ? String(chosen[0]) : "";
    const outside = !multiple && current && source && source.fits(current) === false;
    const noteId = `${c.id}-outside`;
    const statusText = open && list ? this.#status(total, shown.length, loaded.length, typed, list) : "";
    const describedBy = [c.describedBy, outside ? noteId : ""].filter(Boolean).join(" ") || undefined;
    const creating = this.#creating.value;
    const columns = source?.spec.columns?.length ?? 0;

    const choose = (entry: Entry | undefined) => {
      if (!entry) return;
      if (entry.kind === "create") return this.#startCreate(entry.text);
      const v = entry.entity[key] ?? null;
      if (multiple) {
        this.#setValues(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
        this.#query.value = undefined;
        this.#endSearch();
        return;
      }
      this.write(v);
      this.#close();
    };
    const move = (to: number) => {
      const n = entries.length;
      if (!n) return;
      const i = Math.max(0, Math.min(n - 1, to));
      this.#active.value = i;
      if (list && i >= loaded.length - 5 && !list.complete.peek()) void list.ensure(0, loaded.length + this.#pageSize());
      this.querySelector(`#${CSS.escape(optionId(i))}`)?.scrollIntoView({ block: "nearest" });
    };

    const more = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      if (list && !list.complete.peek() && el.scrollTop + el.clientHeight > el.scrollHeight - 80) void list.ensure(0, loaded.length + this.#pageSize());
    };
    const options =
      entries.length === 0
        ? html`<div class="aster-picker-empty">${waiting || list?.status.value === "loading" ? "Searching…" : typed ? `Nothing matches “${query}”.` : "No options."}</div>`
        : this.#entries(entries, chosen, active, optionId, choose);
    return html`<div class="aster-picker" ?data-multiple=${multiple}>
      <label class="aster-field" data-ring-owner style=${anchorStyle(c.id)}>
        ${multiple ? chosen.map((v) => this.#chip(v)) : nothing}
        <input id=${c.id} role="combobox" .value=${live(query ?? label)}
          aria-label=${this.labelled ? nothing : c.label}
          placeholder=${multiple && chosen.length ? "" : this.#placeholder.value || (c.meta?.nullable || multiple ? "None" : "Choose…")}
          aria-expanded=${open ? "true" : "false"} aria-controls=${listId} aria-autocomplete="list"
          aria-activedescendant=${open && entries.length ? optionId(active) : nothing}
          aria-required=${c.state.required ? "true" : nothing}
          aria-invalid=${c.invalid ? "true" : nothing}
          aria-describedby=${describedBy ?? nothing}
          ?readonly=${c.state.readOnly}
          autocomplete="off" spellcheck="false"
          @input=${(e: InputEvent) => {
            // Typing replaces the shown name, even where the engine didn't select it on click.
            const t = (e.target as HTMLInputElement).value;
            this.#type(query === undefined && label && t.startsWith(label) && t.length > label.length ? t.slice(label.length) : t);
          }}
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
                return move(active + (e.key === "ArrowDown" ? 1 : -1));
              case "PageDown":
              case "PageUp":
                if (!isOpen) return;
                e.preventDefault();
                return move(active + (e.key === "PageDown" ? 10 : -10));
              case "Home":
              case "End":
                if (!isOpen) return;
                e.preventDefault();
                return move(e.key === "Home" ? 0 : entries.length - 1);
              case "Enter":
                if (!isOpen) return;
                e.preventDefault();
                return choose(entries[active]);
              case "Escape":
                if (creating) {
                  e.preventDefault();
                  e.stopPropagation();
                  creating.dispose();
                  this.#creating.value = undefined;
                  return;
                }
                if (!isOpen) return;
                e.preventDefault();
                e.stopPropagation();
                return this.#close();
              case "Backspace":
                if (multiple && !(e.target as HTMLInputElement).value && chosen.length) this.#setValues(chosen.slice(0, -1));
                return;
            }
          }}>
        <svg class="aster-picker-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.8 5 6.8l3-3"/></svg>
      </label>
      ${columns
        ? html`<div class="aster-picker-list aster-popover" popover="manual" ${openWhen(open && !creating)} data-columns
            style=${`${placeStyle(c.id)}; grid-template-columns: ${source!.tracks(multiple)}`} @scroll=${more}>
            ${this.#header(source!)}
            <div class="aster-picker-options" id=${listId} role="listbox" aria-label=${c.label} aria-multiselectable=${multiple ? "true" : nothing}>
              ${options}
            </div>
          </div>`
        : html`<div class="aster-picker-list aster-popover" popover="manual" ${openWhen(open && !creating)} style=${placeStyle(c.id)}
            id=${listId} role="listbox" aria-label=${c.label} aria-multiselectable=${multiple ? "true" : nothing} @scroll=${more}>
            ${options}
          </div>`}
      ${creating && source ? this.#createForm(c, source, creating) : nothing}
      <div class="aster-sr-only" role="status">${statusText}</div>
      ${outside
        ? html`<p class="aster-hint aster-picker-outside" id=${noteId}>${label} ${source!.spec.outside ?? "isn’t among the options now."}</p>`
        : nothing}
    </div>`;
  }

  #entries(entries: readonly Entry[], chosen: readonly Value[], active: number, optionId: (i: number) => string, choose: (e: Entry) => void): View {
    const source = this.#source();
    const group = source?.spec.groupBy;
    const key = this.#key();
    const option = (entry: Entry, i: number): TemplateResult => {
      const press = (ev: PointerEvent) => ev.preventDefault();
      if (entry.kind === "create") {
        return html`<div class="aster-option aster-option-create" role="option" id=${optionId(i)} aria-selected="false"
          ?data-active=${i === active} @pointerdown=${press} @click=${() => choose(entry)}>Create “${entry.text}”…</div>`;
      }
      const e = entry.entity;
      const selected = chosen.includes(e[key] ?? null);
      const columns = source?.spec.columns ?? [];
      return html`<div class="aster-option" role="option" id=${optionId(i)} aria-selected=${selected ? "true" : "false"}
        ?data-active=${i === active} ?data-columns=${columns.length > 0} @pointerdown=${press} @click=${() => choose(entry)}>
        ${this.#multiple.peek() ? html`<span class="aster-option-check" aria-hidden="true">${selected ? "✓" : ""}</span>` : nothing}
        <span>${this.#text(e)}</span>${columns.map((f) => html`<span class="aster-option-col">${source!.text(e, f)}</span>`)}
      </div>`;
    };
    if (!group || !source) return html`${entries.map(option)}`;
    // Consecutive options with the same group value go under one heading.
    const runs: { heading: string; items: [Entry, number][] }[] = [];
    entries.forEach((entry, i) => {
      const heading = entry.kind === "option" ? source.text(entry.entity, group) || "None" : "";
      const last = runs.at(-1);
      if (last && last.heading === heading) last.items.push([entry, i]);
      else runs.push({ heading, items: [[entry, i]] });
    });
    return html`${runs.map((run, g) =>
      run.heading
        ? html`<div role="group" aria-labelledby=${`${optionId(0)}-g${g}`}>
            <div class="aster-option-group" id=${`${optionId(0)}-g${g}`} role="presentation">${run.heading}</div>
            ${run.items.map(([e, i]) => option(e, i))}
          </div>`
        : run.items.map(([e, i]) => option(e, i)),
    )}`;
  }

  /** Sorts by a column: outside the listbox, reached by Tab (the list stays open while focus is in the picker). */
  #header(source: PickerOptions): View {
    const title = (f: string) => source.type.field(f)?.title ?? f;
    const sort = source.sort.value?.[0];
    const fields = [source.display, ...(source.spec.columns ?? [])];
    return html`<div class="aster-option aster-option-head" role="group" aria-label="Sort the options" data-columns>
      ${this.#multiple.peek() ? html`<span class="aster-option-check"></span>` : nothing}
      ${fields.map((f, i) => {
        const on = sort?.field === f;
        const label = `Sort by ${title(f)}${on ? (sort!.descending ? ", now descending" : ", now ascending") : ""}`;
        return html`<button type="button" class=${i === 0 ? "aster-option-sort" : "aster-option-sort aster-option-col"} aria-label=${label} aria-pressed=${on ? "true" : "false"}
          @pointerdown=${(e: PointerEvent) => e.preventDefault()}
          @click=${() => source.sortBy(f)}>${title(f)}${on ? html`<span aria-hidden="true"> ${sort!.descending ? "↓" : "↑"}</span>` : nothing}</button>`;
      })}
    </div>`;
  }


  #chip(v: Value): View {
    const record = this.#record(v);
    const name = record ? this.#text(record) : String(v);
    return html`<span class="aster-chip">${name}<button type="button" aria-label=${`Remove ${name}`}
      @click=${(e: MouseEvent) => {
        e.preventDefault();
        this.#setValues(this.#values.peek().filter((x) => x !== v));
        this.focus();
      }}>
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 3l4 4M7 3 3 7"/></svg></button></span>`;
  }

  #createForm(c: ControlContext, source: PickerOptions, edit: EditModel): View {
    const fields = [source.display, ...(source.spec.create ?? []).filter((f) => f !== source.display)];
    const title = source.type.title ?? source.spec.set;
    const cancel = () => {
      edit.dispose();
      this.#creating.value = undefined;
      this.focus();
    };
    const save = async () => {
      const saved = await edit.save();
      if (!saved) return;
      const value = saved.record.entity[source.key] ?? null;
      edit.dispose();
      this.#creating.value = undefined;
      if (this.#multiple.peek()) this.#setValues([...this.#values.peek(), value]);
      else this.write(value);
      this.#close();
      this.focus();
    };
    return html`<form class="aster-picker-create aster-popover" popover="manual" role="dialog" aria-label=${`New ${title.toLowerCase()}`}
      style=${placeStyle(c.id)} ${openWhen(true)}
      @submit=${(e: SubmitEvent) => (e.preventDefault(), void save())}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }}>
      <p class="aster-picker-create-title">New ${title.toLowerCase()}</p>
      ${fields.map((f) =>
        source.type.field(f)?.allowedValues
          ? html`<aster-select .model=${edit} .field=${f} .labelled=${true}></aster-select>`
          : html`<aster-field .model=${edit} .field=${f} .labelled=${true}></aster-field>`,
      )}
      ${edit.formError.value ? html`<p class="aster-error" role="alert">${edit.formError.value}</p>` : nothing}
      <div class="aster-picker-create-actions">
        <button type="button" class="aster-button" data-variant="quiet" @click=${cancel}>Cancel</button>
        <button type="submit" class="aster-button" data-variant="primary" ?disabled=${edit.busy.value}>Create</button>
      </div>
    </form>`;
  }

  #startCreate(text: string): void {
    const source = this.#source();
    if (!source) return;
    const defaults: Record<string, Value> = {};
    for (const f of [source.display, ...(source.spec.create ?? [])]) {
      const meta = source.type.field(f);
      defaults[f] = f === source.display ? text : meta?.nullable ? null : "";
    }
    this.#creating.value = new EditModel(source.ctx, source.spec.set, undefined, defaults);
    this.#focusCreate();
  }

  /** Focuses the create form's first empty field once its fields have rendered. */
  #focusCreate(frames = 10): void {
    requestAnimationFrame(() => {
      const inputs = [...this.querySelectorAll<HTMLInputElement>(".aster-picker-create input")];
      const target = inputs.find((i) => !i.value) ?? inputs[0];
      target?.focus();
      if (document.activeElement !== target && frames > 0) this.#focusCreate(frames - 1);
    });
  }

  #status(total: number | undefined, shown: number, loaded: number, typed: string, list: Collection): string {
    if (total === undefined) return "";
    const n = `${COUNT.format(total)} ${total === 1 ? "match" : "matches"}`;
    if (!typed) return "";
    return total > loaded && !list.complete.peek() ? `${n}, ${COUNT.format(shown)} shown` : n;
  }

  #type(text: string): void {
    this.#query.value = text;
    this.#active.value = 0;
    this.#show();
    const source = this.#source();
    if (!source || source.small) return;
    clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(() => {
      if (!text.trim()) return this.#endSearch();
      this.#search.value = text;
      if (!this.#searching.peek()) {
        const searching = source.search(this.#search);
        this.#searching.value = searching;
        void searching.ensure(0, source.pageSize);
      }
    }, SEARCH_DELAY);
  }

  #setValues(values: readonly Value[]): void {
    this.#values.value = values;
    this.emit("change", values);
  }

  #list(): Collection | undefined {
    const o = this.#options.value;
    return this.#searching.value ?? (o instanceof PickerOptions ? o.all : o);
  }

  #source(): PickerOptions | undefined {
    const o = this.#options.value;
    return o instanceof PickerOptions ? o : undefined;
  }

  #key(): string {
    const o = this.#options.value;
    return this.#valueField.value || (o instanceof PickerOptions ? o.key : o?.type.key[0]) || "id";
  }

  #displayField(): string {
    const o = this.#options.value;
    if (o instanceof PickerOptions) return o.display;
    return this.#display.value || o?.type.titleField || this.#key();
  }

  #text(e: Entity): string {
    const source = this.#source();
    if (source) return source.text(e);
    const v = e[this.#displayField()];
    return v === null || v === undefined ? "" : String(v);
  }

  #searchText(e: Entity): string {
    const source = this.#source();
    const fields = source?.spec.searchFields ?? [this.#displayField()];
    return fields.map((f) => (source ? source.text(e, f) : String(e[f] ?? ""))).join(" ").toLowerCase();
  }

  #record(value: Value | undefined): Entity | undefined {
    if (value === null || value === undefined) return undefined;
    const o = this.#options.value;
    if (o instanceof PickerOptions) return o.record(value)?.value;
    const key = this.#key();
    return o?.items.value.find((e) => e?.[key] === value);
  }

  #pageSize(): number {
    const o = this.#options.peek();
    return o instanceof PickerOptions ? o.pageSize : (o?.pageSize ?? 100);
  }

  #show(): void {
    if (this.#open.peek()) return;
    this.#open.value = true;
    const o = this.#options.peek();
    if (o instanceof PickerOptions) void o.all.ensure(0, o.pageSize);
    else void o?.loadAll();
  }

  #endSearch(): void {
    clearTimeout(this.#searchTimer);
    const searching = this.#searching.peek();
    if (!searching) return;
    this.#searching.value = undefined;
    this.#search.value = "";
    this.#source()?.release(searching);
  }

  #close(): void {
    this.#open.value = false;
    this.#query.value = undefined;
    this.#active.value = 0;
    this.#endSearch();
  }
}

export { PickerOptions, type OptionsSpec } from "./options.ts";

define("aster-picker", Picker);
