import { signal } from "@preact/signals-core";
import type { Value } from "@getaster/data";
import { html, nothing, type TemplateResult } from "lit-html";
import { anchorStyle, openWhen, placeStyle } from "../overlay/anchor.ts";

export interface Option {
  readonly value: Value;
  readonly label: string;
}

/** Whether a choice's list is open, and which option is active in it. */
export class ChoiceState {
  readonly open = signal(false);
  readonly active = signal(0);
}

export interface ChoiceProps {
  readonly id: string;
  readonly options: readonly Option[];
  readonly value: Value | undefined;
  /** Shown when the value isn't one of the options. */
  readonly placeholder: string;
  readonly readOnly?: boolean;
  readonly label?: string;
  readonly labelledBy?: string;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
  readonly choose: (value: Value) => void;
}

/**
 * A select-only combobox: the value in a frame, and a list drawn like the
 * picker's rather than by the platform.
 *
 * Keyboard: ↓/↑, Enter or Space open; in the list ↓/↑, Home and End move,
 * a letter jumps to the next label starting with it, Enter or Space choose,
 * Escape and Tab close. The active option is `aria-activedescendant`.
 */
export function choiceView(state: ChoiceState, p: ChoiceProps): TemplateResult {
  const choices = p.options;
  const current = p.value ?? null;
  const chosen = choices.findIndex((o) => o.value === current);
  const shown = chosen >= 0 ? choices[chosen]!.label : current === null || current === "" ? p.placeholder : String(current);
  const open = state.open.value && !p.readOnly;
  const active = Math.min(state.active.value, choices.length - 1);
  const listId = `${p.id}-options`;
  const optionId = (i: number) => `${p.id}-option-${i}`;
  const choose = (i: number) => {
    const o = choices[i];
    if (o) p.choose(o.value);
    state.open.value = false;
  };
  const show = () => {
    if (p.readOnly) return;
    state.active.value = Math.max(0, chosen);
    state.open.value = true;
  };
  return html`<div class="aster-picker">
    <div class="aster-field aster-select" data-ring-owner style=${anchorStyle(p.id)}
      @click=${(e: MouseEvent) => {
        (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[role=combobox]")?.focus();
        if (state.open.peek()) state.open.value = false; else show();
      }}>
      <div id=${p.id} class="aster-select-value" role="combobox" tabindex="0"
        aria-label=${p.label ?? nothing}
        aria-labelledby=${p.labelledBy ?? nothing}
        aria-haspopup="listbox" aria-expanded=${open ? "true" : "false"} aria-controls=${listId}
        aria-activedescendant=${open ? optionId(active) : nothing}
        aria-readonly=${p.readOnly ? "true" : nothing}
        aria-required=${p.required ? "true" : nothing}
        aria-invalid=${p.invalid ? "true" : nothing}
        aria-describedby=${p.describedBy ?? nothing}
        ?data-placeholder=${chosen < 0}
        @blur=${() => (state.open.value = false)}
          @keydown=${(e: KeyboardEvent) => {
            if (p.readOnly) return;
            const n = choices.length;
            if (!state.open.peek()) {
              if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
                e.preventDefault();
                show();
              }
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
              case " ":
                e.preventDefault();
                return choose(active);
              case "Escape":
                e.preventDefault();
                e.stopPropagation();
                state.open.value = false;
                return;
              case "Tab":
                state.open.value = false;
                return;
              default: {
                if (e.key.length !== 1 || !/\S/.test(e.key)) return;
                const k = e.key.toLowerCase();
                for (let step = 1; step <= n; step++) {
                  const i = (active + step) % n;
                  if (choices[i]!.label.toLowerCase().startsWith(k)) return move(i);
                }
              }
            }
          }}>${shown}</div>
      <svg class="aster-picker-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.8 5 6.8l3-3"/></svg>
    </div>
    <div class="aster-picker-list aster-popover" popover="manual" style=${placeStyle(p.id)} ${openWhen(open)}
      id=${listId} role="listbox" aria-label=${p.label ?? nothing} aria-labelledby=${p.labelledBy ?? nothing}>
      ${choices.map(
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
