import { signal } from "@preact/signals-core";
import type { Value } from "@getaster/data";
import { html, nothing, type TemplateResult } from "lit-html";
import { anchorStyle, openWhen, placeStyle } from "../overlay/anchor.ts";

export interface Option {
  readonly value: Value;
  readonly label: string;
}

/** Whether a choice's list is open, which option is active in it, and the filter text. */
export class ChoiceState {
  readonly open = signal(false);
  readonly active = signal(0);
  readonly query = signal("");
}

export interface ChoiceProps {
  readonly id: string;
  readonly options: readonly Option[];
  readonly value: Value | undefined;
  /** Shown when the value isn't one of the options. */
  readonly placeholder: string;
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly labelledBy?: string;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
  /** Filters the options as the person types, and shows `noResults` when nothing matches. */
  readonly filter?: boolean;
  /** Shows a clear button while a value is chosen. */
  readonly clearable?: boolean;
  /** What the open list says when the filter matches nothing. Default "No matches". */
  readonly noResults?: string;
  readonly choose: (value: Value) => void;
}

/**
 * A select-only combobox: the value in a frame, and a list drawn like the
 * picker's rather than by the platform.
 *
 * Keyboard: ↓/↑, Enter or Space open; in the list ↓/↑, Home and End move,
 * a letter jumps to the next label starting with it, Enter or Space choose,
 * Escape and Tab close. With `filter`, typed text narrows the list and
 * Backspace edits it; Enter chooses the active option. The active option is
 * `aria-activedescendant`.
 */
export function choiceView(state: ChoiceState, p: ChoiceProps): TemplateResult {
  const locked = p.disabled === true;
  const readOnly = p.readOnly === true;
  const filter = p.filter === true;
  const query = filter ? state.query.value : "";
  const all = p.options;
  const choices = filter && query.trim() !== "" ? all.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : all;
  const current = p.value ?? null;
  const chosenAll = all.findIndex((o) => o.value === current);
  const chosen = choices.findIndex((o) => o.value === current);
  const shownValue = chosenAll >= 0 ? all[chosenAll]!.label : current === null || current === "" ? p.placeholder : String(current);
  const shown = filter && state.open.peek() && query !== "" ? query : shownValue;
  const open = state.open.value && !readOnly && !locked;
  const active = choices.length ? Math.min(state.active.value, choices.length - 1) : -1;
  const listId = `${p.id}-options`;
  const optionId = (i: number) => `${p.id}-option-${i}`;
  const close = () => {
    state.open.value = false;
    state.query.value = "";
  };
  const choose = (i: number) => {
    const o = choices[i];
    if (o) p.choose(o.value);
    close();
  };
  const show = () => {
    if (readOnly || locked) return;
    state.active.value = Math.max(0, chosen);
    state.query.value = "";
    state.open.value = true;
  };
  const clearable = p.clearable === true && current !== null && current !== "" && !readOnly && !locked;
  return html`<div class="aster-picker">
    <div class="aster-field aster-select" data-ring-owner style=${anchorStyle(p.id)}
      @click=${(e: MouseEvent) => {
        if (readOnly || locked) return;
        (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[role=combobox]")?.focus();
        if (state.open.peek()) close(); else show();
      }}>
      <div id=${p.id} class="aster-select-value" role="combobox" tabindex=${locked ? "-1" : "0"}
        aria-label=${p.label ?? nothing}
        aria-labelledby=${p.labelledBy ?? nothing}
        aria-haspopup="listbox" aria-expanded=${open ? "true" : "false"} aria-controls=${listId}
        aria-activedescendant=${open && active >= 0 ? optionId(active) : nothing}
        aria-autocomplete=${filter ? "list" : nothing}
        aria-readonly=${readOnly ? "true" : nothing}
        aria-disabled=${locked ? "true" : nothing}
        aria-required=${p.required ? "true" : nothing}
        aria-invalid=${p.invalid ? "true" : nothing}
        aria-describedby=${p.describedBy ?? nothing}
        ?data-placeholder=${chosenAll < 0 && !(filter && query !== "")}
        @blur=${() => close()}
          @keydown=${(e: KeyboardEvent) => {
            if (readOnly || locked) return;
            const n = choices.length;
            if (!state.open.peek()) {
              if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
                e.preventDefault();
                show();
              } else if (filter && isTyping(e)) {
                e.preventDefault();
                state.query.value = e.key;
                state.active.value = 0;
                state.open.value = true;
              }
              return;
            }
            if (filter && isTyping(e)) {
              e.preventDefault();
              state.query.value = query + e.key;
              state.active.value = 0;
              return;
            }
            const move = (i: number) => {
              e.preventDefault();
              state.active.value = i;
            };
            switch (e.key) {
              case "ArrowDown":
                return move(Math.min(n - 1, active + 1));
              case "ArrowUp":
                return move(Math.max(0, active - 1));
              case "Home":
                return move(0);
              case "End":
                return move(n - 1);
              case "Enter":
                e.preventDefault();
                return choose(active);
              case " ":
                if (filter) {
                  e.preventDefault();
                  state.query.value = query + e.key;
                  state.active.value = 0;
                  return;
                }
                e.preventDefault();
                return choose(active);
              case "Backspace":
                if (!filter) return;
                e.preventDefault();
                state.query.value = query.slice(0, -1);
                state.active.value = 0;
                return;
              case "Escape":
                e.preventDefault();
                e.stopPropagation();
                close();
                return;
              case "Tab":
                close();
                return;
              default: {
                if (filter || !isTyping(e)) return;
                const k = e.key.toLowerCase();
                for (let step = 1; step <= n; step++) {
                  const i = (active + step) % n;
                  if (choices[i]!.label.toLowerCase().startsWith(k)) return move(i);
                }
              }
            }
          }}>${shown}</div>
      ${clearable
        ? html`<button type="button" class="aster-select-clear" aria-label=${`Clear ${p.label || "selection"}`}
            @click=${(e: MouseEvent) => {
              e.stopPropagation();
              close();
              p.choose(null);
              const frame = (e.currentTarget as HTMLElement).closest(".aster-select");
              queueMicrotask(() => frame?.querySelector<HTMLElement>("[role=combobox]")?.focus());
            }}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>
          </button>`
        : nothing}
      <svg class="aster-picker-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.8 5 6.8l3-3"/></svg>
    </div>
    <div class="aster-picker-list aster-popover" popover="manual" style=${placeStyle(p.id)} ${openWhen(open)}
      id=${listId} role="listbox" aria-label=${p.label ?? nothing} aria-labelledby=${p.labelledBy ?? nothing}>
      ${choices.length === 0 && filter && query !== ""
        ? html`<div class="aster-choice-empty" role="status">${p.noResults ?? "No matches"}</div>`
        : choices.map(
          (o, i) => html`<div class="aster-option" role="option" id=${optionId(i)}
            aria-selected=${i === chosen ? "true" : "false"} ?data-active=${i === active}
            @pointerdown=${(ev: PointerEvent) => ev.preventDefault()}
            @pointerup=${(ev: PointerEvent) => {
              // WebKit suppresses touch clicks after pointerdown is cancelled to retain focus.
              if (ev.pointerType === "touch" && state.open.peek()) choose(i);
            }}
            @click=${() => { if (state.open.peek()) choose(i); }}>${o.label}</div>`,
        )}
    </div>
  </div>`;
}

/** A printable character typed with no command modifier. */
function isTyping(e: KeyboardEvent): boolean {
  return e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;
}
