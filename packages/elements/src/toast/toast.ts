import { ProgressState, type ProgressPolicy } from "@getaster/data";
import { computed, effect, signal, untracked } from "@preact/signals-core";
import { html, nothing } from "lit-html";
import { AsterElement, define, each, uid, type View } from "../base/element.ts";
import { progressPolicyOf } from "../progress/policy.ts";
import {
  DEFAULT_ACTION_DURATION, DEFAULT_DURATION, resolveToaster, validateToasterChrome, validateToasterFeatures, validateToasterPolicy, validateToastDuration,
  type ToastAction, type ToastDismissReason, type ToastOptions, type ToastPatch, type ToastVariant, type ToasterChrome, type ToasterFeature, type ToasterPolicy,
} from "./config.ts";
import { ToastQueue, type ToastItem } from "./queue.ts";

export type {
  ToastAction, ToastBlock, ToastDismissReason, ToastHold, ToastHoldSource, ToastInline, ToastOptions, ToastPatch, ToastVariant, ToasterChrome, ToasterFeature, ToasterPolicy,
} from "./config.ts";

/** What a toast says at each stage of a promise. The result messages may be built from the outcome. */
export interface ToastPromiseMessages<T> {
  /** Shown while the promise runs. */
  readonly loading: string;
  /** Shown when it resolves: text, or built from the value. */
  readonly success: string | ((value: T) => string);
  /** Shown when it rejects: text, or built from the reason. */
  readonly error: string | ((reason: unknown) => string);
}

/** What `promise` takes for the result toast; the loading toast takes only the id. */
export interface ToastPromiseOptions {
  /** The toast's id, so a caller can update or dismiss it. Default: generated. */
  readonly id?: string;
  /** An action on the result toast, such as Retry. */
  readonly action?: ToastAction;
  /** How long the result stays, in milliseconds; `null` until dismissed. Default by variant. */
  readonly duration?: number | null;
  /** Called once with the reason the result toast left. */
  readonly onDismiss?: (reason: ToastDismissReason) => void;
}

/** What `toast-change` carries: a toast was shown, updated in place, or dismissed (with why). */
export interface ToastChangeDetail {
  /** The toast's id. */
  readonly id: string;
  /** What happened to it. */
  readonly change: "shown" | "updated" | "dismissed";
  /** Its message at that moment. */
  readonly message: string;
  /** Its variant at that moment. */
  readonly variant: ToastVariant;
  /** Why it left; only with `change: "dismissed"`. */
  readonly reason?: ToastDismissReason;
}

const MARKS: Record<ToastVariant, View> = {
  info: html`<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v3.6M8 5v.1"/></svg>`,
  success: html`<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M5.2 8.2l2 2 3.6-4"/></svg>`,
  warning: html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.4v3.2M8 11.6v.1"/></svg>`,
  error: html`<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>`,
  loading: html`<svg viewBox="0 0 16 16" aria-hidden="true" class="aster-toast-spin"><circle cx="8" cy="8" r="6.2" opacity=".3"/><path d="M8 1.8a6.2 6.2 0 0 1 6.2 6.2"/></svg>`,
};

/**
 * Toasts for results with no visible place of their own, or to offer Undo.
 * Up to `maxVisible` show at once and the rest queue. Errors are assertive
 * (`role="alert"`) and stay until dismissed; the others are polite and time out
 * after `duration`, or `actionDuration` with an action. Hovering, focusing
 * inside, an open modal dialog or `pause()` holds every timer.
 */
export class Toaster extends AsterElement {
  readonly #items = this.prop<readonly ToastItem[]>([]);
  readonly #duration = this.prop(DEFAULT_DURATION);
  readonly #actionDuration = this.prop(DEFAULT_ACTION_DURATION);
  readonly #policy = this.prop<ToasterPolicy>({});
  readonly #features = this.prop<readonly ToasterFeature[]>([]);
  readonly #chrome = this.prop<ToasterChrome>({});
  readonly #progressPolicy = this.prop<ProgressPolicy>({});
  readonly #settings = computed(() => resolveToaster(this.#policy.value, this.#features.value, this.#chrome.value));
  readonly #id = uid("aster-toast");
  readonly #queue = new ToastQueue({
    clock: { now: () => performance.now(), set: (run, ms) => setTimeout(run, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    settings: () => this.#settings.peek(),
    defaults: () => ({ duration: this.#duration.peek(), actionDuration: this.#actionDuration.peek() }),
    changed: (items) => {
      this.#items.value = items;
      // A removed toast never fires pointerleave or focusout.
      if (items.length === 0) {
        this.#queue.hold("hover", false);
        this.#queue.hold("focus", false);
      }
    },
    notify: (change, item, reason) =>
      this.emit<ToastChangeDetail>("toast-change", { id: item.id, change, message: item.message, variant: item.variant, ...(reason ? { reason } : {}) }, { cancelable: false }),
  });
  #pausedByHost = false;

  /** How long an info, success or warning toast with no action stays, in milliseconds. Default 6000. */
  get duration(): number {
    return this.#duration.value;
  }
  set duration(v: number) {
    this.#duration.value = validateToastDuration(v) ?? DEFAULT_DURATION;
  }
  /** How long such a toast with an action stays, in milliseconds. Default 10000. */
  get actionDuration(): number {
    return this.#actionDuration.value;
  }
  set actionDuration(v: number) {
    this.#actionDuration.value = validateToastDuration(v) ?? DEFAULT_ACTION_DURATION;
  }

  /** What a host permits: `{ autoDismiss, dismissOnEscape }`. */
  get policy(): ToasterPolicy {
    return this.#policy.value;
  }
  set policy(v: ToasterPolicy) {
    this.#policy.value = validateToasterPolicy(v);
    this.#queue.reconfigure();
  }
  /** How toasts behave: `{ kind: "stack", max }` and `{ kind: "hold", while }`. */
  get features(): readonly ToasterFeature[] {
    return this.#features.value;
  }
  set features(v: readonly ToasterFeature[]) {
    this.#features.value = validateToasterFeatures(v);
    this.#queue.reconfigure();
  }
  /** What shows: `{ position, icon, dismissButton }`. */
  get chrome(): ToasterChrome {
    return this.#chrome.value;
  }
  set chrome(v: ToasterChrome) {
    this.#chrome.value = validateToasterChrome(v);
  }
  /** Sugar for the stack feature's `max`: how many toasts show at once. Default 3. */
  get maxVisible(): number {
    return this.#settings.value.max;
  }
  set maxVisible(v: number) {
    this.features = [...this.#features.peek().filter((f) => f.kind !== "stack"), { kind: "stack", max: v }];
  }
  /** Timing for the loading toast of `promise`. Merged over the page's `provideProgressPolicy`. */
  get progressPolicy(): ProgressPolicy {
    return this.#progressPolicy.value;
  }
  set progressPolicy(v: ProgressPolicy) {
    this.#progressPolicy.value = Object.freeze({ ...v });
  }

  /**
   * Shows a message and returns its toast's id. The second argument is an
   * action (`{ label, run }`) or [[object:ToastOptions]]. Showing an id that
   * exists updates that toast.
   */
  show(message: string, actionOrOptions?: ToastAction | ToastOptions): string {
    const given = actionOrOptions as Partial<ToastAction> | undefined;
    const options: ToastOptions = given && typeof given.run === "function" && typeof given.label === "string"
      ? { action: given as ToastAction }
      : (actionOrOptions as ToastOptions | undefined) ?? {};
    return this.#queue.show(message, options);
  }

  /** Changes a showing toast in place. Returns false when `id` is not showing or queued. */
  update(id: string, patch: ToastPatch): boolean {
    return this.#queue.update(id, patch);
  }

  /** Dismisses the toast with this id, or the newest showing one without an id. */
  dismiss(id?: string): void {
    const target = id ?? this.#queue.newestShown()?.id;
    if (target !== undefined) this.#queue.dismiss(target, "api");
  }

  /** Dismisses every toast, showing or queued. */
  dismissAll(): void {
    this.#queue.dismissAll("api");
  }

  /** Holds every timer until `resume()`. Pointer, focus and modal dialogs hold independently. */
  pause(): void {
    this.#pausedByHost = true;
    this.#queue.hold("api", true);
  }
  resume(): void {
    this.#pausedByHost = false;
    if (this.isConnected) this.#queue.hold("api", false);
  }

  /**
   * Shows a loading toast while `promise` runs, then its result in the same
   * toast, and returns `promise` itself. The loading toast waits for the
   * progress policy's delay and the result for its minimum time, so a fast
   * operation shows only its result.
   */
  promise<T>(promise: Promise<T>, messages: ToastPromiseMessages<T>, options: ToastPromiseOptions = {}): Promise<T> {
    const id = options.id ?? uid("aster-toast-promise");
    const busy = signal(true);
    const state = new ProgressState(() => ({ busy: busy.value }), () => ({ ...progressPolicyOf(this), ...this.#progressPolicy.value }));
    let outcome: { readonly variant: ToastVariant; readonly text: string } | undefined;
    let done = false;
    const stop = effect(() => {
      const phase = state.phase.value;
      untracked(() => {
        if (phase === "working" && !outcome) this.show(messages.loading, { id, variant: "loading" });
        else if (phase === "idle" && outcome && !done) {
          done = true;
          this.show(outcome.text, {
            id, variant: outcome.variant,
            ...(options.action ? { action: options.action } : {}),
            ...(options.duration !== undefined ? { duration: options.duration } : {}),
            ...(options.onDismiss ? { onDismiss: options.onDismiss } : {}),
          });
          queueMicrotask(() => { stop(); state.dispose(); });
        }
      });
    });
    const settle = (variant: ToastVariant, text: () => string) => {
      let said: string;
      try { said = text(); } catch { said = variant === "error" ? "Something went wrong" : "Done"; }
      outcome = { variant, text: said };
      busy.value = false;
    };
    promise.then(
      (value) => settle("success", () => typeof messages.success === "function" ? messages.success(value) : messages.success),
      (reason: unknown) => settle("error", () => typeof messages.error === "function" ? messages.error(reason) : messages.error),
    );
    return promise;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.#pausedByHost) this.#queue.hold("api", false);
    const modal = () => this.#queue.hold("modal", document.querySelector("dialog:modal") !== null);
    // A dialog announces itself with `open` and `close`; the page's modal state is read, never patched.
    document.addEventListener("open", modal);
    document.addEventListener("close", modal);
    this.onDisconnect(() => {
      document.removeEventListener("open", modal);
      document.removeEventListener("close", modal);
      this.#queue.hold("api", true);
    });
    this.listen(document, "keydown", (e) => this.#escape(e));
    modal();
  }

  protected render(): View {
    const items = this.#items.value.filter((i) => i.shown);
    const settings = this.#settings.value;
    const polite = items.filter((i) => i.variant !== "error");
    const alerts = items.filter((i) => i.variant === "error");
    return html`<div class="aster-toasts" data-block=${settings.block} data-inline=${settings.inline}
      @pointerenter=${() => this.#queue.hold("hover", true)}
      @pointerleave=${() => this.#queue.hold("hover", false)}
      @focusin=${() => this.#queue.hold("focus", true)}
      @focusout=${(e: FocusEvent) => !this.contains(e.relatedTarget as Node | null) && this.#queue.hold("focus", false)}>
      <div class="aster-toast-group">
        ${each(alerts, (i) => i.id, (i) => this.#toast(i))}
      </div>
      <div class="aster-toast-group" role="status" aria-atomic="false" aria-relevant="additions text">
        ${each(polite, (i) => i.id, (i) => this.#toast(i))}
      </div>
    </div>`;
  }

  #toast(item: ToastItem): View {
    const settings = this.#settings.value;
    const textId = `${this.#id}-${item.id}`;
    const dismissable = item.duration === null || settings.dismissButton;
    return html`<div class="aster-toast" data-id=${item.id} data-variant=${item.variant}
      role=${item.variant === "error" ? "alert" : nothing}>
      ${settings.icon ? html`<span class="aster-toast-mark">${MARKS[item.variant]}</span>` : nothing}
      <span class="aster-toast-text" id=${textId}>${item.message}</span>
      ${item.progress === undefined ? nothing : html`<progress class="aster-toast-progress" max="1" .value=${item.progress} aria-labelledby=${textId}></progress>
        <span class="aster-toast-percent" aria-hidden="true">${Math.round(item.progress * 100)}%</span>`}
      ${item.action ? html`<button type="button" class="aster-toast-action" @click=${() => this.#act(item)}>${item.action.label}</button>` : nothing}
      ${dismissable ? html`<button type="button" class="aster-toast-dismiss" aria-label="Dismiss"
        @click=${() => this.#queue.dismiss(item.id, "button")}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>` : nothing}
    </div>`;
  }

  #act(item: ToastItem): void {
    const action = item.action;
    this.#queue.dismiss(item.id, "action");
    action?.run();
  }

  #escape(e: KeyboardEvent): void {
    if (e.key !== "Escape" || e.defaultPrevented || !this.#settings.peek().dismissOnEscape) return;
    // Escape belongs to the focused control unless focus is in the toaster or nowhere in particular.
    const focus = document.activeElement;
    if (focus && focus !== document.body && !this.contains(focus)) return;
    const inside =(e.target as Element | null)?.closest?.(".aster-toast[data-id]")?.getAttribute("data-id");
    const id = inside && this.#queue.has(inside) ? inside : this.#queue.newestShown()?.id;
    if (id === undefined) return;
    e.preventDefault();
    this.#queue.dismiss(id, "escape");
  }
}

define("aster-toaster", Toaster);

let region: HTMLElement | undefined;

/** Tells screen readers about a background result, with no popup. */
export function announce(text: string): void {
  if (!region?.isConnected) {
    region = document.createElement("p");
    region.className = "aster-sr-only";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  region.textContent = "";
  const r = region;
  requestAnimationFrame(() => (r.textContent = text));
}
