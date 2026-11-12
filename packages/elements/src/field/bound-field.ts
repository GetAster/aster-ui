import type { EditModel, Field as FieldMeta, FieldState, Value } from "@getaster/data";
import { DEFAULT_STATE } from "@getaster/data";
import { html, nothing } from "lit-html";
import { AsterElement, uid, type View } from "../base/element.ts";
import { formatValue } from "./values.ts";

/**
 * Where a shown label sits: above the control, or before it on the same
 * line. A check also takes `"end"`, after its box.
 */
export type LabelPosition = "above" | "start" | "end";

/** When a bound field revalidates its own value. */
export type ValidateOn = "submit" | "change" | "exit";

/** What a control needs to render itself inside a bound field. */
export interface ControlContext {
  readonly id: string;
  readonly name: string;
  readonly meta: FieldMeta | undefined;
  readonly value: Value | undefined;
  readonly state: FieldState;
  /** `aria-describedby` for the control: its error, hint, reasons and pending note. */
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
  readonly #labelPosition = this.prop<LabelPosition>("above");
  readonly #shared = this.prop<ReadonlyMap<string, string>>(new Map());
  readonly #hint = this.prop("");
  readonly #showErrors = this.prop(true);
  readonly #validateOn = this.prop<ValidateOn>("submit");
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
   * Where a shown label sits. Default `"above"`. `"start"` puts the label,
   * its "Optional" marker and Revert before the control, following the text
   * direction; hints, reasons and errors stay below the control.
   */
  get labelPosition(): LabelPosition {
    return this.#labelPosition.value;
  }
  set labelPosition(v: LabelPosition) {
    const allowed = this.labelPositions();
    if (!allowed.includes(v)) throw new TypeError(`${this.localName} labelPosition must be ${allowed.join(", ")}`);
    this.#labelPosition.value = v;
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

  /** Help text under the control, in addition to the label. */
  get hint(): string {
    return this.#hint.value;
  }
  set hint(v: string) {
    this.#hint.value = v;
  }

  /** Whether to draw the error under the control. Default `true`; the control still reports `aria-invalid`. */
  get showErrors(): boolean {
    return this.#showErrors.value;
  }
  set showErrors(v: boolean) {
    this.#showErrors.value = v;
  }

  /**
   * When the field revalidates itself: only when the host validates
   * (`"submit"`, the default), after every edit (`"change"`), or when focus
   * leaves it (`"exit"`).
   */
  get validateOn(): ValidateOn {
    return this.#validateOn.value;
  }
  set validateOn(v: ValidateOn) {
    if (v !== "submit" && v !== "change" && v !== "exit") throw new TypeError('validateOn must be "submit", "change" or "exit"');
    this.#validateOn.value = v;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.listen(this, "focusout", (event) => {
      if (this.#validateOn.peek() !== "exit") return;
      const next = (event as FocusEvent).relatedTarget;
      if (next instanceof Node && this.contains(next)) return;
      const model = this.#model.peek();
      const name = this.#field.peek();
      if (model?.type.field(name)) model.validateField(name);
    });
  }

  protected abstract control(c: ControlContext): View;

  /** Control-specific validation supplements the model's errors. */
  protected validation(_meta: FieldMeta | undefined, _value: Value | undefined): string | undefined { return undefined; }

  /** The label positions this field accepts. */
  protected labelPositions(): readonly LabelPosition[] { return ["above", "start"]; }

  /** True when the control draws a shown label itself, on its own line, instead of the head above. */
  protected labelBeside(): boolean { return false; }

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
    const model = this.#model.peek();
    if (!model) return;
    const name = this.#field.peek();
    model.set(name, value);
    if (this.#validateOn.peek() === "change") model.validateField(name);
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
    const hint = this.#hint.value;
    const showErrors = this.#showErrors.value;
    const reason = state.readOnly ? state.reasons.readOnly : undefined;
    const disabledReason = state.enabled ? undefined : state.reasons.enabled;
    const sharedId = (text: string | undefined) => (text === undefined ? undefined : this.#shared.value.get(text));
    const hintId = hint ? `${this.#uid}-hint` : undefined;
    const errorId = showErrors && error ? `${this.#uid}-error` : undefined;
    const reasonShared = sharedId(reason);
    const disabledShared = sharedId(disabledReason);
    const reasonId = reason ? reasonShared ?? `${this.#uid}-reason` : undefined;
    const disabledId = disabledReason ? disabledShared ?? `${this.#uid}-disabled` : undefined;
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
      describedBy: [errorId ?? "", hintId ?? "", reasonId ?? "", disabledId ?? "", changed ? pendingId : "", suggested ? suggestedId : ""].filter(Boolean).join(" ") || undefined,
      invalid: error !== undefined,
      label,
    };
    this.setAttribute("data-field", name);
    this.toggleAttribute("data-pending", pending);
    this.toggleAttribute("data-readonly", state.readOnly);
    this.toggleAttribute("data-disabled", !state.enabled);
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
    const beside = this.#labelled.value && this.labelBeside();
    // CSS puts the head in a column before the control.
    if (this.#labelled.value && !beside && this.#labelPosition.value === "start") this.setAttribute("data-label-position", "start");
    else this.removeAttribute("data-label-position");
    const row = hidden ? this.#hiddenValue(c) : this.row(c);
    return html`${this.#labelled.value && !beside
        ? html`<div class="aster-field-head">
            <label class="aster-field-label" id=${`${this.#uid}-label`} for=${this.#uid}>${label}</label>
            ${meta && !state.required && !state.readOnly ? html`<span class="aster-optional">Optional</span>` : nothing}
            ${revert}
          </div>`
        : nothing}
      ${beside ? html`<div class="aster-field-line">${row}${revert}</div>` : row}
      ${hint && hintId ? html`<p class="aster-hint" id=${hintId}>${hint}</p>` : nothing}
      ${suggested ? html`<p class="aster-hint" id=${suggestedId}>Suggested value</p>` : nothing}
      ${changed ? html`<span class="aster-sr-only" id=${pendingId}>${pendingText}</span>` : nothing}
      ${reason && reasonId && !reasonShared ? html`<p class="aster-hint" id=${reasonId}>${reason}</p>` : nothing}
      ${disabledReason && disabledId && !disabledShared ? html`<p class="aster-hint" id=${disabledId}>${disabledReason}</p>` : nothing}
      ${showErrors && error && errorId ? html`<p class="aster-error" id=${errorId} role="alert">${error}</p>` : nothing}`;
  }
}
