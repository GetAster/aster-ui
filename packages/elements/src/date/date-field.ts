import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { define, type View } from "../base/element.ts";
import { BoundField, type ControlContext } from "../field/bound-field.ts";
import { anchorStyle } from "../overlay/anchor.ts";
import { CalendarState, calendarView, closeOutside } from "./calendar.ts";
import { formatDate, parseDate, today } from "./dates.ts";

/**
 * A date field: typed dates in the forms people write them ("7 Oct",
 * "7/10/2026", "2026-10-07"), shown as "7 Oct 2026", with a calendar
 * button that opens the APG date-picker dialog. What's typed is kept as
 * typed while the input has focus; text that isn't a date stays text, and
 * validation says so.
 *
 * The calendar button takes focus on press in every engine (macOS engines
 * don't focus buttons on click), so focus never falls to the body between
 * the input and the calendar: a grid row being edited would end its edit.
 */
export class DateField extends BoundField {
  readonly #calendar = new CalendarState();
  /** What's being typed, while the input has focus. */
  readonly #draft = this.prop<string | undefined>(undefined);

  override focus(options?: FocusOptions): void {
    this.querySelector<HTMLElement>("input")?.focus(options);
  }

  protected control(c: ControlContext): View {
    const value = typeof c.value === "string" ? c.value : undefined;
    const readOnly = c.state.readOnly;
    const open = this.#calendar.open.value;
    const text = this.#draft.value ?? (value === undefined ? "" : formatDate(value));
    const button = `${c.id}-calendar`;
    const close = (refocus: boolean) => {
      this.#calendar.open.value = false;
      if (refocus) this.querySelector<HTMLElement>(`#${CSS.escape(button)}`)?.focus();
    };
    return html`<div class="aster-field aster-date" data-ring-owner style=${anchorStyle(c.id)}>
        <input id=${c.id} .value=${live(text)}
          aria-label=${this.labelled ? nothing : c.label}
          placeholder=${c.meta?.nullable ? "None" : "A date, like 7 Oct"}
          ?readonly=${readOnly}
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
        choose: (date) => {
          this.write(date);
          close(false);
          this.querySelector<HTMLInputElement>("input")?.focus();
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
