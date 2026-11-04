import type { Field as FieldMeta, Value } from "@getaster/data";
import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext } from "../field/bound-field.ts";
import { anchorStyle } from "../overlay/anchor.ts";
import { CalendarState, calendarView, closeOutside } from "./calendar.ts";
import { formatDate, isIsoDate, parseDate, today, type DateFormat } from "./dates.ts";

/**
 * A date field: typed dates in the forms people write them ("7 Oct",
 * "7/10/2026", "2026-10-07"), shown as "7 Oct 2026", with a calendar
 * button that opens the APG date-picker dialog. What's typed is kept as
 * typed while the input has focus; text that isn't a date stays text, and
 * validation says so.
 *
 * `min` and `max` bound the calendar and the value; `format` chooses how a
 * date is written. The calendar button takes focus on press in every engine
 * (macOS engines don't focus buttons on click), so focus never falls to the
 * body between the input and the calendar: a grid row being edited would end
 * its edit.
 */
export class DateField extends BoundField {
  readonly #calendar = new CalendarState();
  /** What's being typed, while the input has focus. */
  readonly #draft = this.prop<string | undefined>(undefined);
  readonly #min = this.prop<string | undefined>(undefined);
  readonly #max = this.prop<string | undefined>(undefined);
  readonly #format = this.prop<DateFormat>("medium");
  readonly #placeholder = this.prop("");
  readonly #dismissOnSelect = this.prop(true);

  /** The earliest date that can be chosen, `YYYY-MM-DD`, inclusive. */
  get min(): string | undefined {
    return this.#min.value;
  }
  set min(v: string | undefined) {
    if (v !== undefined && !isIsoDate(v)) throw new TypeError("min must be a date, like 2026-10-07");
    this.#min.value = v;
  }
  /** The latest date that can be chosen, `YYYY-MM-DD`, inclusive. */
  get max(): string | undefined {
    return this.#max.value;
  }
  set max(v: string | undefined) {
    if (v !== undefined && !isIsoDate(v)) throw new TypeError("max must be a date, like 2026-10-07");
    this.#max.value = v;
  }
  /** How a date is written in the input: `"medium"` (default), `"short"` or `"iso"`. */
  get format(): DateFormat {
    return this.#format.value;
  }
  set format(v: DateFormat) {
    if (v !== "medium" && v !== "short" && v !== "iso") throw new TypeError('format must be "medium", "short" or "iso"');
    this.#format.value = v;
  }
  /** Placeholder text. Default: "None" for a nullable field, otherwise a date hint. */
  get placeholder(): string {
    return this.#placeholder.value;
  }
  set placeholder(v: string) {
    this.#placeholder.value = v;
  }
  /** Whether choosing a day closes the calendar. Default `true`. */
  get dismissOnSelect(): boolean {
    return this.#dismissOnSelect.value;
  }
  set dismissOnSelect(v: boolean) {
    this.#dismissOnSelect.value = v;
  }

  override focus(options?: FocusOptions): void {
    this.querySelector<HTMLElement>("input")?.focus(options);
  }

  protected override validation(_meta: FieldMeta | undefined, value: Value | undefined): string | undefined {
    if (typeof value !== "string" || !isIsoDate(value)) return undefined;
    const min = this.#min.value;
    const max = this.#max.value;
    if (min !== undefined && max !== undefined && min > max) return "The earliest date is after the latest date.";
    if (min !== undefined && value < min) return `Choose ${formatDate(min)} or later.`;
    if (max !== undefined && value > max) return `Choose ${formatDate(max)} or earlier.`;
    return undefined;
  }

  protected control(c: ControlContext): View {
    const value = typeof c.value === "string" ? c.value : undefined;
    const readOnly = c.state.readOnly;
    const disabled = !c.state.enabled;
    const open = this.#calendar.open.value;
    const text = this.#draft.value ?? (value === undefined ? "" : formatDate(value, this.#format.value));
    const placeholder = this.#placeholder.value || (c.meta?.nullable ? "None" : "A date, like 7 Oct");
    const button = `${c.id}-calendar`;
    const close = (refocus: boolean) => {
      this.#calendar.open.value = false;
      if (refocus) this.querySelector<HTMLElement>(`#${CSS.escape(button)}`)?.focus();
    };
    return html`<div class="aster-field aster-date" data-ring-owner style=${anchorStyle(c.id)}>
        <input id=${c.id} .value=${live(text)}
          aria-label=${this.labelled ? nothing : c.label}
          placeholder=${placeholder}
          ?readonly=${readOnly} ?disabled=${disabled}
          aria-required=${c.state.required ? "true" : nothing}
          aria-invalid=${c.invalid ? "true" : nothing}
          aria-describedby=${c.describedBy ?? nothing}
          autocomplete="off" spellcheck="false"
          @input=${(e: InputEvent) => {
            const t = (e.target as HTMLInputElement).value;
            this.#draft.value = t;
            this.write(t.trim() === "" ? null : parseDate(t, Number(today().slice(0, 4))) ?? t);
          }}
          @blur=${() => (this.#draft.value = undefined)}>
        ${readOnly
          ? nothing
          : html`<button type="button" class="aster-date-button" id=${button} aria-label=${`Choose ${c.label}`}
              aria-haspopup="dialog" aria-expanded=${open ? "true" : "false"} aria-controls=${`${c.id}-dialog`}
              ?disabled=${disabled}
              @pointerdown=${(e: PointerEvent) => (e.currentTarget as HTMLElement).focus()}
              @mousedown=${(e: MouseEvent) => e.preventDefault()}
              @click=${() => (open ? close(false) : this.#open(value))}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>
            </button>`}
      </div>
      ${calendarView(this.#calendar, {
        id: `${c.id}-dialog`,
        anchor: c.id,
        value,
        today: today(),
        label: `Choose ${c.label}`,
        min: this.#min.value,
        max: this.#max.value,
        choose: (date) => {
          this.write(date);
          if (this.#dismissOnSelect.peek()) {
            close(false);
            this.querySelector<HTMLInputElement>("input")?.focus();
          }
        },
        dismiss: close,
      })}`;
  }

  #open(value: string | undefined): void {
    this.#calendar.show(value, today());
    closeOutside(this.#calendar, this);
  }
}

define("aster-date", DateField);
