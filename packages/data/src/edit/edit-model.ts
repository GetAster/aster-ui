import { batch, computed, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import { diff, isEmpty, type ChangeSet, type FieldChange } from "../changes/changeset.ts";
import type { DataContext, Saved } from "../context.ts";
import type { StoredRecord } from "../store/store.ts";
import { ODataError } from "../odata/errors.ts";
import type { Entity, EntityType, Value } from "../schema/model.ts";
import { CriteriaError } from "../criteria/values.ts";
import { DEFAULT_STATE, type Case, type Explanation, type FieldState, type PageScope, type StateRules } from "../scope/scope.ts";
import { keyFromText, type KeyText } from "../store/keys.ts";
import { validateEntity, type FieldErrors } from "../validate/validate.ts";

/**
 * An application rule: errors by field for the current values. A rule's
 * message wins over the metadata's for the same field, so it can say what
 * the metadata can't ("already a member") or say it better for the screen.
 */
export type Rule = (values: Entity) => Readonly<Record<string, string | undefined>>;

export interface EditOptions {
  readonly rules?: readonly Rule[];
}

const NONE: ReadonlySet<string> = new Set();

/**
 * A field's page rules. With `clearWhenHidden`, hiding a shown field clears
 * its value. `derived` gives the field a value from the page: cases for
 * `scope.select`, or a signal computed in code, in the field's JSON form.
 * On a read-only field it always replaces the value; on an editable one it's
 * a suggestion that stops once the person changes the field.
 */
export interface FieldRules extends StateRules {
  readonly clearWhenHidden?: boolean;
  readonly derived?: readonly Case[] | ReadonlySignal<unknown>;
}

/** An edit's working state, enough to resume it after a reload. Plain data. */
export interface EditDraft {
  readonly key?: KeyText;
  readonly baseline: Entity;
  readonly values: Entity;
  readonly etag?: string;
  readonly forced: readonly string[];
  /** Fields with a derived value that the person changed, so the suggestion no longer applies. */
  readonly typed?: readonly string[];
}

export interface Conflict {
  /** The record as it now is on the server. */
  readonly theirs: Entity;
  /** Fields both sides changed since editing began. */
  readonly fields: readonly string[];
}

/**
 * Uncommitted values for one record, apart from the stored record.
 *
 * Invariant: `baseline` is the stored record the edit started from (or the
 * defaults for a new one); a field is pending when its value differs from
 * the baseline, or when pending is forced on.
 *
 * A field hidden on the stored record (`StoredRecord.hidden`) is read-only,
 * never pending and never sent: its `null` isn't a value the person has, so
 * neither a change, a check nor a save may act on it. Every diff below goes
 * through `#diff`, which leaves hidden fields out.
 */
export class EditModel {
  readonly entitySet: string;
  readonly type: EntityType;
  readonly #ctx: DataContext;
  readonly #rules: readonly Rule[];
  readonly #key = signal<KeyText | undefined>(undefined);
  readonly #baseline = signal<Entity>({});
  readonly #hidden = signal<ReadonlySet<string>>(NONE);
  #baseEtag: string | undefined;
  readonly #values = signal<Entity>({});
  readonly #forced = signal<ReadonlySet<string>>(new Set());
  readonly #errors = signal<FieldErrors>({});
  readonly #formError = signal<string | undefined>(undefined);
  readonly #busy = signal(false);
  readonly #conflict = signal<Conflict | undefined>(undefined);
  readonly #deleted = signal(false);
  /** Fields with a derived value that the person has changed since. */
  readonly #typed = signal<ReadonlySet<string>>(new Set());
  readonly #derived = new Map<string, ReadonlySignal<unknown>>();
  readonly #derivedNow = new Map<string, ReadonlySignal<boolean>>();
  /** Derived fields written in this task, to name them if they never settle. */
  #writes: string[] = [];
  readonly #pending = new Map<string, ReadonlySignal<boolean>>();
  readonly #ruled = signal<ReadonlyMap<string, ReadonlySignal<FieldState>>>(new Map());
  readonly #states = new Map<string, ReadonlySignal<FieldState>>();
  readonly #disposers: (() => void)[] = [];
  /** A past change shown over its old values: read-only, never saved. */
  #replay = false;
  #explainer: { readonly scope: PageScope; readonly target: string } | undefined;

  readonly key: ReadonlySignal<KeyText | undefined> = this.#key;
  readonly baseline: ReadonlySignal<Entity> = this.#baseline;
  readonly values: ReadonlySignal<Entity> = this.#values;
  /** Fields the server hides from this caller on the record; their value is unknown, not empty. */
  readonly hidden: ReadonlySignal<ReadonlySet<string>> = this.#hidden;
  readonly errors: ReadonlySignal<FieldErrors> = this.#errors;
  /** A failure that isn't about one field. */
  readonly formError: ReadonlySignal<string | undefined> = this.#formError;
  readonly busy: ReadonlySignal<boolean> = this.#busy;
  readonly conflict: ReadonlySignal<Conflict | undefined> = this.#conflict;
  /** The record was deleted, by someone else or elsewhere in this client. Saving is refused. */
  readonly deleted: ReadonlySignal<boolean> = this.#deleted;
  readonly isNew = computed(() => this.#key.value === undefined);
  readonly dirty = computed(() => !isEmpty(this.#diff(this.#baseline.value, this.#values.value)));
  /** Whether the current values would pass `validate()`, without showing errors. */
  readonly valid = computed(() => Object.keys(this.#check(this.#values.value)).length === 0);

  /** Edits an existing record when `key` is given, otherwise a new one starting from `defaults`. */
  constructor(ctx: DataContext, set: string, key?: KeyText, defaults: Entity = {}, options: EditOptions = {}) {
    this.#ctx = ctx;
    this.#rules = options.rules ?? [];
    this.entitySet = set;
    this.type = ctx.schema.set(set).type;
    if (key === undefined) {
      this.#baseline.value = defaults;
      this.#values.value = defaults;
    } else {
      const stored = ctx.store.get(set, key);
      if (!stored) throw new Error(`${set} ${key} isn't loaded`);
      this.#key.value = key;
      this.#baseline.value = stored.entity;
      this.#values.value = stored.entity;
      this.#hidden.value = stored.hidden ?? NONE;
      this.#baseEtag = stored.etag;
    }
    const unsubscribe = ctx.store.subscribe((change) => {
      if (change.set !== set || change.key !== this.#key.peek()) return;
      if (change.origin.kind === "save" && change.origin.by === this) return;
      if (change.after) this.#theirs(change.after);
      else {
        batch(() => {
          this.#deleted.value = true;
          this.#formError.value = "This record has been deleted, so these changes can't be saved.";
        });
      }
    });
    this.#disposers.push(unsubscribe);
  }

  /**
   * A change shown as it was made: `before` is the baseline and `after` the
   * values, so pending marks exactly what changed. Every field is read-only
   * and nothing is saved.
   */
  static replay(ctx: DataContext, set: string, before: Entity, after: Entity, forced: readonly string[] = []): EditModel {
    const m = new EditModel(ctx, set, undefined, before);
    m.#replay = true;
    m.#values.value = after;
    m.#forced.value = new Set(forced);
    return m;
  }

  /** A past change shown over its old values (`replay`), not an edit. */
  get replaying(): boolean {
    return this.#replay;
  }

  /** The ETag of the version the edit started from. */
  get etag(): string | undefined {
    return this.#baseEtag;
  }

  /**
   * Takes what was saved elsewhere (a deep update of a parent) as the new
   * starting point: the saved record if given, otherwise the current values.
   */
  accept(saved?: StoredRecord): void {
    batch(() => {
      if (saved) {
        this.#baseline.value = saved.entity;
        this.#values.value = saved.entity;
        this.#hidden.value = saved.hidden ?? NONE;
        this.#baseEtag = saved.etag;
      } else {
        this.#baseline.value = this.#values.peek();
      }
      this.#forced.value = new Set();
      this.#typed.value = new Set();
      this.#errors.value = {};
      this.#formError.value = undefined;
    });
  }

  /** Shows errors the server gave for these fields, such as a deep update's errors on a child. */
  showErrors(errors: FieldErrors): void {
    this.#errors.value = errors;
  }

  /** The working state, for keeping across a reload. */
  draft(): EditDraft {
    const key = this.#key.peek();
    return {
      ...(key === undefined ? {} : { key }),
      baseline: this.#baseline.peek(),
      values: this.#values.peek(),
      ...(this.#baseEtag === undefined ? {} : { etag: this.#baseEtag }),
      forced: [...this.#forced.peek()],
      ...(this.#typed.peek().size ? { typed: [...this.#typed.peek()] } : {}),
    };
  }

  /**
   * Takes up a draft of this record. If the stored record has moved on since,
   * that's handled as any external change: followed where it touches nothing
   * edited, otherwise a conflict.
   */
  resume(draft: EditDraft): void {
    if (draft.key !== this.#key.peek()) throw new Error(`a draft of ${draft.key ?? "a new record"} doesn't fit ${this.#key.peek() ?? "a new record"}`);
    batch(() => {
      this.#baseline.value = draft.baseline;
      this.#values.value = draft.values;
      this.#baseEtag = draft.etag;
      this.#forced.value = new Set(draft.forced);
      this.#typed.value = new Set(draft.typed ?? []);
    });
    const key = this.#key.peek();
    const stored = key === undefined ? undefined : this.#ctx.store.get(this.entitySet, key);
    if (stored) {
      this.#hidden.value = stored.hidden ?? NONE;
      this.#theirs(stored);
    }
  }

  get(name: string): Value | undefined {
    return this.#values.value[name];
  }

  /**
   * Sets a value. A field that's read-only keeps its value and shows the
   * reason as its error. Once a field shows an error, the error follows the
   * value: it changes with it and clears as soon as the value is valid.
   * Empty text is null on a field marked `emptyAsNull`.
   */
  set(name: string, entered: Value): void {
    const value = entered === "" && this.#field(name).emptyAsNull ? null : entered;
    const state = this.state(name).peek();
    if (state.readOnly) {
      this.#errors.value = { ...this.#errors.peek(), [name]: [state.reasons.readOnly ?? `${this.#title(name)} is read-only.`] };
      return;
    }
    batch(() => {
      this.#values.value = { ...this.#values.peek(), [name]: value };
      if (this.#derived.has(name) && !this.#typed.peek().has(name)) this.#typed.value = new Set(this.#typed.peek()).add(name);
      if (this.#errors.peek()[name]) {
        const { [name]: _, ...rest } = this.#errors.peek();
        const now = this.#check(this.#values.peek())[name];
        this.#errors.value = now ? { ...rest, [name]: now } : rest;
      }
    });
  }

  /**
   * Page rules for some fields, named `<target>.<field>` in the scope's
   * `explain`. Call once, before the fields are shown.
   */
  applyRules(scope: PageScope, target: string, rules: Readonly<Record<string, FieldRules>>): void {
    this.#explainer = { scope, target };
    const ruled = new Map(this.#ruled.peek());
    for (const [name, { clearWhenHidden: _, derived, ...state }] of Object.entries(rules)) {
      const field = this.#field(name);
      ruled.set(name, scope.state(`${target}.${name}`, state));
      if (derived === undefined) continue;
      if (field.computed) throw new Error(`${this.type.name}.${name} is set by the server, so it can't have a derived value`);
      if ("peek" in derived) this.#derived.set(name, derived);
      else {
        const selected = scope.select(derived, `${target}.${name}`);
        this.#derived.set(name, selected);
        this.#disposers.push(() => selected.dispose());
      }
    }
    this.#ruled.value = ruled;
    for (const name of Object.keys(rules)) if (rules[name]!.derived !== undefined) this.#derive(name, `${target}.${name}`);
    for (const [name, { clearWhenHidden }] of Object.entries(rules)) {
      if (!clearWhenHidden) continue;
      // Only a change from shown to hidden clears; a field that starts
      // hidden keeps its value, whatever order the page was set up in.
      let shown: boolean | undefined;
      this.#disposers.push(
        effect(() => {
          const visible = this.state(name).value.visible;
          const hid = shown === true && !visible;
          shown = visible;
          if (!hid) return;
          untracked(() => {
            if ((this.#values.peek()[name] ?? null) !== null) {
              this.#values.value = { ...this.#values.peek(), [name]: null };
            }
          });
        }),
      );
    }
  }

  /**
   * Whether the field holds its derived value: suggested or replaced, not
   * typed over. False for a field without one.
   */
  derived(name: string): ReadonlySignal<boolean> {
    let d = this.#derivedNow.get(name);
    if (!d) {
      d = computed(() => {
        const source = this.#derived.get(name);
        if (!source || this.#typed.value.has(name)) return false;
        const v = source.value;
        return v !== undefined && Object.is(v ?? null, this.#values.value[name] ?? null);
      });
      this.#derivedNow.set(name, d);
    }
    return d;
  }

  /**
   * Follows a field's derived value. A read-only field always takes it. An
   * editable one takes it when it changes, until the person types in the
   * field; a new record takes it from the start, while an existing one keeps
   * its stored value until the derived value first changes. An `undefined`
   * derived value (no case applies, a related record still loading) leaves
   * the value alone.
   */
  #derive(name: string, path: string): void {
    const source = this.#derived.get(name)!;
    let seen: { readonly v: unknown } | undefined;
    this.#disposers.push(
      effect(() => {
        const v = source.value;
        const { readOnly } = this.state(name).value;
        const typed = this.#typed.value.has(name);
        // A read-only field follows its own value too, so a revert is replaced again.
        const current = readOnly ? this.#values.value[name] : undefined;
        if (v === undefined || this.#replay || this.#deleted.value) return;
        if (v !== null && typeof v === "object") throw new CriteriaError(`the derived value of ${path} isn't a plain value`);
        const changed = seen !== undefined && !Object.is(seen.v, v);
        const first = seen === undefined;
        seen = { v };
        const apply = readOnly ? !typed : !typed && (changed || (first && untracked(() => this.isNew.value)));
        if (!apply || Object.is((readOnly ? current : untracked(() => this.#values.value[name])) ?? null, v)) return;
        untracked(() => this.#write(name, path, v as Value));
      }),
    );
  }

  /** Writes a derived value; a loop between derived values surfaces here with the fields in it. */
  #write(name: string, path: string, v: Value): void {
    if (this.#writes.length === 0) queueMicrotask(() => (this.#writes = []));
    this.#writes.push(path);
    try {
      this.#values.value = { ...this.#values.peek(), [name]: v };
    } catch (e) {
      if (e instanceof Error && e.message === "Cycle detected") {
        const fields = [...new Set(this.#writes)].join(", ");
        throw new CriteriaError(`derived values feed each other and never settle: ${fields}`);
      }
      throw e;
    }
  }

  /** The page rules behind a field's state, with what they read now. */
  explain(name: string): Explanation[] {
    const e = this.#explainer;
    const rules = e ? e.scope.explain(`${e.target}.${name}`) : [];
    const source = this.#derived.get(name);
    if (source && !rules.some((r) => r.effect === "derived")) rules.push({ effect: "derived", rule: { op: "and", args: [] }, holds: source.peek() !== undefined, reads: {}, value: source.peek() });
    return rules.map((r) => r.effect === "derived" ? { ...r, overridden: this.#typed.peek().has(name), current: this.#values.peek()[name] } : r);
  }

  /**
   * A field's state: its page rules, then what the metadata and the record
   * say. Computed fields are read-only, immutable ones once saved, and every
   * field of a deleted record; a non-nullable field is required.
   */
  state(name: string): ReadonlySignal<FieldState> {
    let state = this.#states.get(name);
    if (!state) {
      const field = this.#field(name);
      state = computed(() => {
        const ruled = this.#ruled.value.get(name)?.value ?? DEFAULT_STATE;
        const reasons = { ...ruled.reasons };
        let readOnly = ruled.readOnly;
        if (this.#replay) {
          readOnly = true;
          reasons.readOnly = "This is a past change.";
        } else if (this.#deleted.value) {
          readOnly = true;
          reasons.readOnly = "This record has been deleted.";
        } else if (this.#hidden.value.has(name)) {
          readOnly = true;
          reasons.readOnly = `You can't see ${this.#title(name)} on this record.`;
        } else if (field.computed || (field.immutable && !this.isNew.value)) {
          readOnly = true;
          reasons.readOnly ??= field.computed
            ? `${this.#title(name)} is set by the server.`
            : `${this.#title(name)} can't be changed once it's set.`;
        }
        const required = ruled.required || (!field.nullable && !field.computed);
        return Object.freeze({ ...ruled, readOnly, required, reasons: Object.freeze(reasons) });
      });
      this.#states.set(name, state);
    }
    return state;
  }

  pending(name: string): ReadonlySignal<boolean> {
    let p = this.#pending.get(name);
    if (!p) {
      p = computed(
        () =>
          !this.#hidden.value.has(name) &&
          (this.#forced.value.has(name) || !Object.is(this.#baseline.value[name] ?? null, this.#values.value[name] ?? null)),
      );
      this.#pending.set(name, p);
    }
    return p;
  }

  forcePending(name: string, on: boolean): void {
    const next = new Set(this.#forced.peek());
    if (on) next.add(name);
    else next.delete(name);
    this.#forced.value = next;
  }

  /** Puts the starting value back; a derived field takes suggestions again from the next change. */
  revert(name?: string): void {
    batch(() => {
      if (name === undefined) {
        this.#values.value = this.#baseline.peek();
        this.#errors.value = {};
        this.#typed.value = new Set();
      } else {
        if (this.#typed.peek().has(name)) {
          const typed = new Set(this.#typed.peek());
          typed.delete(name);
          this.#typed.value = typed;
        }
        this.#values.value = { ...this.#values.peek(), [name]: this.#baseline.peek()[name] ?? null };
        const { [name]: _, ...rest } = this.#errors.peek();
        this.#errors.value = rest;
      }
    });
  }

  /** Validates every field and shows the errors; returns whether the values can be saved. */
  validate(): boolean {
    const errors = this.#check(this.#values.peek());
    this.#errors.value = errors;
    return Object.keys(errors).length === 0;
  }

  /**
   * Errors for `values`: metadata checks (on update, only for changed
   * fields), required-by-rule on every ruled field, then app rules, whose
   * messages win. Hidden fields aren't checked; the server still is.
   */
  #check(values: Entity): FieldErrors {
    const mode = untracked(() => this.isNew.value) ? "create" : "update";
    const changed = mode === "create" ? values : this.#changed(values);
    const errors: Record<string, readonly string[]> = { ...validateEntity(this.type, changed, mode) };
    for (const name of this.#ruled.value.keys()) {
      const state = this.state(name).value;
      if (state.required && (values[name] ?? null) === null && !errors[name] && !this.#hidden.value.has(name)) {
        errors[name] = [`${this.#title(name)} is required.`];
      }
    }
    const ruled = new Set<string>();
    for (const rule of this.#rules) {
      for (const [name, message] of Object.entries(rule(values))) {
        if (message === undefined || ruled.has(name)) continue;
        errors[name] = [message];
        ruled.add(name);
      }
    }
    for (const name of Object.keys(errors)) {
      if (this.type.field(name) && (!this.state(name).value.visible || this.#hidden.value.has(name))) delete errors[name];
    }
    return errors;
  }

  /** The change a save would make, or `undefined` when nothing changed. */
  changes(): ChangeSet | undefined {
    const changes = this.#diff(this.#baseline.peek(), this.#values.peek());
    const key = this.#key.peek();
    if (key === undefined) return { kind: "create", set: this.entitySet, values: this.#values.peek() };
    if (isEmpty(changes)) return undefined;
    return { kind: "update", set: this.entitySet, key: keyFromText(key), changes };
  }

  /**
   * Validates, then creates or updates. Field errors from the server land on
   * their fields. On a 412 the newer record is loaded: when the other change
   * touched none of the fields edited here, the edit is rebased onto it and
   * sent once more; otherwise `conflict` is set. Returns `undefined` when
   * nothing was saved, and then `errors`, `formError`, `conflict` or
   * `deleted` says why.
   */
  async save(): Promise<Saved | undefined> {
    if (this.#replay || this.#busy.peek() || this.#conflict.peek() || this.#deleted.peek()) return undefined;
    if (!this.validate()) return undefined;
    if (this.#key.peek() !== undefined && !this.dirty.peek()) return undefined;
    this.#busy.value = true;
    this.#formError.value = undefined;
    try {
      let saved: Saved | undefined;
      let sent: Entity = this.#values.peek();
      for (let attempt = 0; saved === undefined; attempt++) {
        const etag = this.#baseEtag;
        sent = this.#values.peek();
        try {
          saved = await this.#send();
        } catch (e) {
          const rebased = e instanceof ODataError && e.status === 412 && this.#baseEtag !== etag && !this.#conflict.peek();
          if (!rebased || attempt > 0) throw e;
          if (!this.validate()) return undefined;
        }
      }
      // Changes typed while the save was in flight stay, on top of the saved record.
      const later = this.#diff(sent, this.#values.peek());
      const values: Record<string, Value> = { ...saved.record.entity };
      batch(() => {
        this.#hidden.value = saved.record.hidden ?? NONE;
        for (const [name, c] of Object.entries(later)) if (!this.#hidden.peek().has(name)) values[name] = c.to;
        this.#key.value = saved.key;
        this.#baseline.value = saved.record.entity;
        this.#values.value = values;
        this.#baseEtag = saved.record.etag;
        this.#forced.value = new Set();
        this.#errors.value = {};
      });
      return saved;
    } catch (e) {
      if (!(e instanceof ODataError)) throw e;
      batch(() => {
        const fieldErrors = e.fieldErrors();
        this.#errors.value = fieldErrors;
        const explained = this.#conflict.peek() || this.#deleted.peek() || Object.keys(fieldErrors).length > 0;
        if (!explained) this.#formError.value = e.message;
      });
      return undefined;
    } finally {
      this.#busy.value = false;
    }
  }

  #send(): Promise<Saved> {
    const key = this.#key.peek();
    return key === undefined
      ? this.#ctx.create(this.entitySet, this.#values.peek(), this)
      : this.#ctx.update(this.entitySet, key, this.#changedValues(), this);
  }

  /** Takes the server's record as the new baseline and keeps local changes on top. */
  rebase(): void {
    const conflict = this.#conflict.peek();
    const stored = this.#key.peek() === undefined ? undefined : this.#ctx.store.get(this.entitySet, this.#key.peek()!);
    if (!conflict || !stored) return;
    const mine = this.#diff(this.#baseline.peek(), this.#values.peek());
    const values: Record<string, Value> = { ...stored.entity };
    batch(() => {
      this.#hidden.value = stored.hidden ?? NONE;
      for (const [name, c] of Object.entries(mine)) if (!this.#hidden.peek().has(name)) values[name] = c.to;
      this.#baseline.value = stored.entity;
      this.#values.value = values;
      this.#baseEtag = stored.etag;
      this.#conflict.value = undefined;
    });
  }

  /** Drops local changes in favour of the server's record. */
  discard(): void {
    const key = this.#key.peek();
    const stored = key === undefined ? undefined : this.#ctx.store.get(this.entitySet, key);
    batch(() => {
      if (stored) {
        this.#baseline.value = stored.entity;
        this.#hidden.value = stored.hidden ?? NONE;
        this.#baseEtag = stored.etag;
      }
      this.#values.value = this.#baseline.peek();
      this.#errors.value = {};
      this.#conflict.value = undefined;
    });
  }

  dispose(): void {
    for (const dispose of this.#disposers.splice(0)) dispose();
  }

  /**
   * Another change to this record arrived: follow it when idle, otherwise
   * flag a conflict. A field it hides that was edited here differs from the
   * baseline (it's now `null`), so it's a conflict rather than a change
   * quietly dropped.
   */
  #theirs(record: StoredRecord): void {
    const { entity: theirs, etag } = record;
    if (etag !== undefined && etag === this.#baseEtag) return;
    const mine = this.#diff(this.#baseline.peek(), this.#values.peek());
    if (isEmpty(mine)) {
      batch(() => {
        this.#baseline.value = theirs;
        this.#values.value = theirs;
        this.#hidden.value = record.hidden ?? NONE;
        this.#baseEtag = etag;
      });
      return;
    }
    const base = this.#baseline.peek();
    const fields = Object.keys(mine).filter((name) => !Object.is(theirs[name] ?? null, base[name] ?? null) || record.hidden?.has(name));
    if (fields.length === 0) {
      const values: Record<string, Value> = { ...theirs };
      for (const [name, c] of Object.entries(mine)) values[name] = c.to;
      batch(() => {
        this.#baseline.value = theirs;
        this.#values.value = values;
        this.#hidden.value = record.hidden ?? NONE;
        this.#baseEtag = etag;
      });
      return;
    }
    this.#conflict.value = { theirs, fields };
  }

  /** Field changes from `a` to `b`, leaving out the fields hidden on the record. */
  #diff(a: Entity, b: Entity): Record<string, FieldChange> {
    const changes = diff(a, b);
    for (const name of this.#hidden.value) delete changes[name];
    return changes;
  }

  #changedValues(): Entity {
    return this.#changed(this.#values.peek());
  }

  #changed(values: Entity): Entity {
    const out: Record<string, Value> = {};
    for (const [name, c] of Object.entries(this.#diff(untracked(() => this.#baseline.value), values))) out[name] = c.to;
    return out;
  }

  #title(name: string): string {
    return this.type.field(name)?.title ?? name;
  }

  #field(name: string) {
    const field = this.type.field(name);
    if (!field) throw new Error(`${this.type.name} has no field ${name}`);
    return field;
  }
}
