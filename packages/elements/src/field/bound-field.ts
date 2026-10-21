import type { EditModel, Field as FieldMeta, FieldState, Value } from "@getaster/data";
import { DEFAULT_STATE } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, uid, type View } from "../base/element.ts";
import { formatValue } from "./values.ts";

/** What a control needs to render itself inside a bound field. */
export interface ControlContext {
  readonly id: string;
  readonly name: string;
  readonly meta: FieldMeta | undefined;
  readonly value: Value | undefined;
  readonly state: FieldState;
  /** `aria-describedby` for the control: the error, then the read-only reason. */
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly label: string;
}

/**
 * A control bound to one field of an edit model, with what every field
 * shows: its label and required marker, pending styling and a revert, the
 * read-only reason, and the error under it.
 *
 * The field's state (from metadata and page rules) decides: a hidden field
 * renders nothing and a read-only one shows its reason. Most fields are
 * required, so the label marks the optional ones; the control carries
 * `aria-required` either way.
 * Pending is the model's: the value differs from the baseline, or it's forced.
 * A value the server hides on this record shows as a read-only box saying
 * "Hidden", whatever the control, with the reason as its description.
 */
export abstract class BoundField extends AsterElement {
  readonly #model = this.prop<EditModel | undefined>(undefined);
  readonly #field = this.prop("");
  readonly #label = this.prop("");
  readonly #labelled = this.prop(false);
  readonly #shared = this.prop<ReadonlyMap<string, string>>(new Map());
  readonly #uid = uid("aster-field");

  get model(): EditModel | undefined {
    return this.#model.value;
  }
  set model(v: EditModel | undefined) {
    this.#model.value = v;
  }
  get field(): string {
    return this.#field.value;
  }
  set field(v: string) {
    this.#field.value = v;
  }
  /** The label; defaults to the field's title from metadata. */
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  /** Show the label above the control. Otherwise it's the accessible name only. */
  get labelled(): boolean {
    return this.#labelled.value;
  }
  set labelled(v: boolean) {
    this.#labelled.value = v;
  }

  /**
   * Reasons shown once for several fields, by the id of the element that
   * shows them; such a reason isn't repeated here, only referenced.
   */
  get sharedReasons(): ReadonlyMap<string, string> {
    return this.#shared.value;
  }
  set sharedReasons(v: ReadonlyMap<string, string>) {
    this.#shared.value = v;
  }

  protected abstract control(c: ControlContext): View;

  /** Control-specific validation supplements the model's errors. */
  protected validation(_meta: FieldMeta | undefined, _value: Value | undefined): string | undefined { return undefined; }

  /** The frame and anything beside it; a subclass can wrap the control. */
  protected row(c: ControlContext): View {
    return this.control(c);
  }

  /** A value as words, for the revert's label; a picker names the record. */
  protected describe(meta: FieldMeta | undefined, value: Value | undefined): string {
    return formatValue(meta, value);
  }

  #hiddenValue(c: ControlContext): View {
    return html`<label class="aster-field aster-field-hidden" data-ring-owner>
      <input id=${c.id} type="text" readonly .value=${""} placeholder="Hidden"
        aria-label=${this.#labelled.value ? nothing : c.label}
        aria-describedby=${c.describedBy ?? nothing}>
    </label>`;
  }

  protected write(value: Value): void {
    this.#model.peek()?.set(this.#field.peek(), value);
  }

  protected render(): View {
    const model = this.#model.value;
    const name = this.#field.value;
    const meta = model?.type.field(name);
    const state = model && meta ? model.state(name).value : DEFAULT_STATE;
    this.hidden = !state.visible;
    if (!state.visible) return nothing;
    const hidden = model?.hidden.value.has(name) ?? false;
    const error = model?.errors.value[name]?.[0] ?? this.validation(meta, model?.values.value[name]);
    const pending = model && meta ? model.pending(name).value : false;
    const reason = state.readOnly ? state.reasons.readOnly : undefined;
    const sharedId = reason === undefined ? undefined : this.#shared.value.get(reason);
    const errorId = `${this.#uid}-error`;
    const reasonId = sharedId ?? `${this.#uid}-reason`;
    const pendingId = `${this.#uid}-pending`;
    const suggestedId = `${this.#uid}-suggested`;
    const suggested = !hidden && !state.readOnly && (model?.derived(name).value ?? false);
    // A new record's fields aren't "changed"; a new list row says it's new in its first cell. A replay says what its change did.
    const replay = model?.replaying ?? false;
    const changed = pending && (replay || !model?.isNew.value);
    const label = this.#label.value || meta?.title || name;
    const c: ControlContext = {
      id: this.#uid,
      name,
      meta,
      value: model?.values.value[name],
      state,
      describedBy: [error ? errorId : "", reason ? reasonId : "", changed ? pendingId : "", suggested ? suggestedId : ""].filter(Boolean).join(" ") || undefined,
      invalid: error !== undefined,
      label,
    };
    this.toggleAttribute("data-pending", pending);
    this.toggleAttribute("data-readonly", state.readOnly);
    this.toggleAttribute("data-value-hidden", hidden);
    this.toggleAttribute("data-suggested", suggested);
    const was = this.describe(meta, model?.baseline.value[name]) || "empty";
    // Pending is drawn as a dot and an edge; this says it in words.
    const added = replay && (model?.baseline.value[name] ?? null) === null && model?.values.value[name] !== undefined && Object.keys(model.baseline.value).length === 0;
    const pendingText = !replay ? `Changed, not saved yet; was ${was}` : added ? "Added in this change" : `Changed in this change; was ${was}`;
    const revert =
      pending && !state.readOnly && !model?.isNew.value
        ? html`<button type="button" class="aster-revert" title=${`Was ${was}`}
            aria-label=${`Revert ${label} to ${was}`}
            @click=${() => model?.revert(name)}>Revert</button>`
        : nothing;
    return html`${this.#labelled.value
        ? html`<div class="aster-field-head">
            <label class="aster-field-label" id=${`${this.#uid}-label`} for=${this.#uid}>${label}</label>
            ${meta && !state.required && !state.readOnly ? html`<span class="aster-optional">Optional</span>` : nothing}
            ${revert}
          </div>`
        : nothing}
      ${hidden ? this.#hiddenValue(c) : this.row(c)}
      ${suggested ? html`<p class="aster-hint" id=${suggestedId}>Suggested value</p>` : nothing}
      ${changed ? html`<span class="aster-sr-only" id=${pendingId}>${pendingText}</span>` : nothing}
      ${reason && !sharedId ? html`<p class="aster-hint" id=${reasonId}>${reason}</p>` : nothing}
      ${error ? html`<p class="aster-error" id=${errorId} role="alert">${error}</p>` : nothing}`;
  }
}
