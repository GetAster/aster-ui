import { signal } from "@preact/signals-core";
import { html, nothing, type TemplateResult } from "lit-html";
import { ref } from "lit-html/directives/ref.js";
import { openWhen, placeStyle } from "../overlay/anchor.ts";
import { monthWeeks, shift, weekBounds } from "./dates.ts";

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const WEEKDAYS = [
  ["Mo", "Monday"],
  ["Tu", "Tuesday"],
  ["We", "Wednesday"],
  ["Th", "Thursday"],
  ["Fr", "Friday"],
  ["Sa", "Saturday"],
  ["Su", "Sunday"],
] as const;

/** Whether the calendar is open, and the day that has focus in it. */
export class CalendarState {
  readonly open = signal(false);
  readonly focused = signal("");
  /** Set on opening: the focused day takes focus once rendered. */
  focusPending = false;

  show(value: string | undefined, today: string): void {
    this.focused.value = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
    this.focusPending = true;
    this.open.value = true;
  }
}

/** Closes the calendar on a press outside `root`, until it closes. */
export function closeOutside(state: CalendarState, root: Element): void {
  const outside = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) state.open.value = false;
  };
  document.addEventListener("pointerdown", outside, { capture: true });
  const stop = state.open.subscribe((open) => {
    if (open) return;
    document.removeEventListener("pointerdown", outside, { capture: true });
    queueMicrotask(() => stop());
  });
}

export interface CalendarProps {
  readonly id: string;
  /** The anchor's `anchor-name`, without the dashes. */
  readonly anchor: string;
  readonly value: string | undefined;
  readonly today: string;
  readonly label: string;
  readonly choose: (date: string) => void;
  /** Closed without a choice: Escape, or a press outside. */
  readonly dismiss: (refocus: boolean) => void;
}

/**
 * The APG date-picker dialog: a month grid in a top-layer popover.
 *
 * Keyboard in the grid: arrows by day and week, Page Up/Down by month (with
 * Shift, by year), Home/End to the week's start and end, Enter or Space
 * choose. Tab cycles through the dialog's buttons and the grid; Escape
 * closes. The focused day is the grid's one tab stop, and moving it to
 * another month turns the page.
 */
export function calendarView(state: CalendarState, p: CalendarProps): TemplateResult | typeof nothing {
  if (!state.open.value) return nothing;
  const focused = state.focused.value;
  const headingId = `${p.id}-month`;
  const move = (to: string) => {
    state.focused.value = to;
    queueMicrotask(() => document.getElementById(`${p.id}-${to}`)?.focus());
  };
  const page = (by: { months?: number; years?: number }) => (state.focused.value = shift(focused, by));
  const grid = (e: KeyboardEvent) => {
    const to = gridKey(e, focused);
    if (to) {
      e.preventDefault();
      move(to);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      p.choose(focused);
    }
  };
  const dialog = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      p.dismiss(true);
    } else if (e.key === "Tab") {
      const stops = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button, [tabindex='0']")];
      const at = stops.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
    }
  };
  const month = focused.slice(0, 7);
  return html`<div class="aster-calendar aster-popover" popover="manual" role="dialog" aria-modal="true" aria-label=${p.label}
    id=${p.id} style=${placeStyle(p.anchor)} ${openWhen(true)} @keydown=${dialog}
    ${ref(() => {
      if (!state.focusPending) return;
      state.focusPending = false;
      requestAnimationFrame(() => document.getElementById(`${p.id}-${state.focused.peek()}`)?.focus());
    })}>
    <div class="aster-calendar-head">
      <button type="button" aria-label="Previous year" @click=${() => page({ years: -1 })}>«</button>
      <button type="button" aria-label="Previous month" @click=${() => page({ months: -1 })}>‹</button>
      <h2 id=${headingId} aria-live="polite">${MONTH.format(Date.parse(`${month}-15T12:00:00Z`))}</h2>
      <button type="button" aria-label="Next month" @click=${() => page({ months: 1 })}>›</button>
      <button type="button" aria-label="Next year" @click=${() => page({ years: 1 })}>»</button>
    </div>
    <table role="grid" aria-labelledby=${headingId} @keydown=${grid}>
      <thead><tr>${WEEKDAYS.map(([short, long]) => html`<th scope="col" abbr=${long}>${short}</th>`)}</tr></thead>
      <tbody>
        ${monthWeeks(focused).map(
          (week) => html`<tr>${week.map((day) =>
            day.slice(0, 7) !== month
              ? html`<td></td>`
              : html`<td role="gridcell" id=${`${p.id}-${day}`} tabindex=${day === focused ? "0" : "-1"}
                  aria-selected=${day === p.value ? "true" : nothing} aria-current=${day === p.today ? "date" : nothing}
                  aria-label=${DAY.format(Date.parse(`${day}T12:00:00Z`))}
                  @click=${() => p.choose(day)}>${Number(day.slice(8))}</td>`,
          )}</tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

/** Where a key moves the focused day, or undefined if it doesn't. */
export function gridKey(e: Pick<KeyboardEvent, "key" | "shiftKey">, from: string): string | undefined {
  switch (e.key) {
    case "ArrowLeft":
      return shift(from, { days: -1 });
    case "ArrowRight":
      return shift(from, { days: 1 });
    case "ArrowUp":
      return shift(from, { days: -7 });
    case "ArrowDown":
      return shift(from, { days: 7 });
    case "PageUp":
      return shift(from, e.shiftKey ? { years: -1 } : { months: -1 });
    case "PageDown":
      return shift(from, e.shiftKey ? { years: 1 } : { months: 1 });
    case "Home":
      return weekBounds(from)[0];
    case "End":
      return weekBounds(from)[1];
    default:
      return undefined;
  }
}
