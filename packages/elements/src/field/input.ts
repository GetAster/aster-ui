import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";

/** Scalar input chrome shared by record fields and standalone query drafts. */
export function inputView(p: {
  readonly value: string;
  readonly input: (text: string) => void;
  readonly id?: string;
  readonly label?: string;
  readonly type?: string;
  readonly keyboard?: string;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
  readonly rows?: number;
}) {
  return html`<label class=${p.rows ? "aster-field aster-field-prose" : "aster-field"} data-ring-owner>
    ${p.rows ? html`<textarea id=${p.id ?? nothing} rows=${p.rows} .value=${live(p.value)}
      aria-label=${p.label ?? nothing} placeholder=${p.placeholder || nothing} ?readonly=${p.readOnly}
      aria-required=${p.required ? "true" : nothing} aria-invalid=${p.invalid ? "true" : nothing}
      aria-describedby=${p.describedBy ?? nothing}
      @input=${(e: InputEvent) => p.input((e.target as HTMLTextAreaElement).value)}></textarea>`
      : html`<input id=${p.id ?? nothing} type=${p.type ?? "text"} inputmode=${p.keyboard || nothing} .value=${live(p.value)}
        aria-label=${p.label ?? nothing} placeholder=${p.placeholder || nothing} ?readonly=${p.readOnly}
        aria-required=${p.required ? "true" : nothing} aria-invalid=${p.invalid ? "true" : nothing}
        aria-describedby=${p.describedBy ?? nothing} autocomplete="off" spellcheck="false"
        @focus=${(e: FocusEvent) => p.readOnly && (e.target as HTMLInputElement).select()}
        @input=${(e: InputEvent) => p.input((e.target as HTMLInputElement).value)}>`}
  </label>`;
}
