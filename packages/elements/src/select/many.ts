import type { Value } from "@getaster/data";
import { html, nothing } from "lit-html";
import type { Option } from "./choice.ts";

/** The same finite multi-choice control for record rules and query drafts. */
export function manyView(p: {
  readonly label: string;
  readonly options: readonly Option[];
  readonly values: readonly Value[];
  readonly change: (values: readonly Value[]) => void;
  readonly readOnly?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
  readonly pending?: boolean;
}) {
  const missing = p.values.filter((v) => !p.options.some((o) => o.value === v));
  const options = [...p.options, ...missing.map((value) => ({ value, label: `Unavailable: ${String(value)}` }))];
  return html`<fieldset class="aster-rule-many" tabindex="-1" aria-invalid=${p.invalid ? "true" : nothing}
    aria-describedby=${p.describedBy ?? nothing} ?disabled=${p.readOnly} ?data-pending=${p.pending}>
    <legend class="aster-sr-only">${p.label}</legend>
    ${options.map((o) => html`<label><input type="checkbox" .checked=${p.values.includes(o.value)}
      @change=${(e: Event) => {
        const input = e.target as HTMLInputElement;
        const group = input.closest("fieldset");
        p.change(input.checked ? [...p.values, o.value] : p.values.filter((v) => v !== o.value));
        queueMicrotask(() => {
          if (!input.isConnected && group?.isConnected) (group.querySelector("input") ?? group).focus();
        });
      }}>${o.label}</label>`)}
  </fieldset>`;
}
