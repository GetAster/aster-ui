import {
  RESUME_MS, toastDuration, validateToastAction, validateToastDuration, validateToastProgress, validateToastVariant,
  type ToastAction, type ToastDismissReason, type ToastHold, type ToastOptions, type ToastPatch, type ToastVariant, type ToasterSettings,
} from "./config.ts";

/** A toast as the view reads it. */
export interface ToastItem {
  readonly id: string;
  readonly message: string;
  readonly variant: ToastVariant;
  readonly action: ToastAction | undefined;
  /** Milliseconds it stays once shown, or `null` until dismissed. */
  readonly duration: number | null;
  readonly progress: number | undefined;
  /** In the first `max` places; the rest wait their turn. */
  readonly shown: boolean;
}

interface Entry {
  id: string;
  message: string;
  variant: ToastVariant;
  action: ToastAction | undefined;
  duration: number | null;
  progress: number | undefined;
  onDismiss: ((reason: ToastDismissReason) => void) | undefined;
  /** Time left; counted down only while shown and not held. */
  remaining: number;
  startedAt: number | undefined;
  handle: unknown;
}

export interface ToastClock {
  now(): number;
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export type ToastChange = "shown" | "updated" | "dismissed";

export interface ToastQueueHooks {
  readonly clock: ToastClock;
  readonly settings: () => ToasterSettings;
  readonly defaults: () => { readonly duration: number; readonly actionDuration: number };
  /** The list changed; the view re-renders from `items()`. */
  readonly changed: (items: readonly ToastItem[]) => void;
  readonly notify: (change: ToastChange, item: ToastItem, reason?: ToastDismissReason) => void;
}

/**
 * The toasts in arrival order. The first `max` are shown (sticky ones at most
 * `max - 1` of them) and the rest queue;
 * a toast's timer runs only while it is shown and nothing holds the stack, so
 * every toast is on screen for its whole time. No DOM, no signals: the element
 * supplies a clock and re-renders from `changed`.
 */
export class ToastQueue {
  readonly #hooks: ToastQueueHooks;
  readonly #entries: Entry[] = [];
  readonly #holds = new Set<ToastHold>();
  #ids = 0;

  constructor(hooks: ToastQueueHooks) {
    this.#hooks = hooks;
  }

  items(): readonly ToastItem[] {
    const shown = this.#shownSet();
    return this.#entries.map((e) => view(e, shown.has(e)));
  }

  has(id: string): boolean {
    return this.#entries.some((e) => e.id === id);
  }

  /** Shows a toast, or replaces the one with this id, or reuses an identical one with `dedupe`. Returns its id. */
  show(message: string, options: ToastOptions = {}): string {
    if (typeof message !== "string") throw new TypeError("message must be a string");
    const variant = options.variant === undefined ? "info" : validateToastVariant(options.variant);
    const action = options.action === undefined ? undefined : validateToastAction(options.action);
    const requested = options.duration === undefined ? undefined : validateToastDuration(options.duration);
    const progress = options.progress === undefined ? undefined : validateToastProgress(options.progress);
    if (options.id !== undefined && (typeof options.id !== "string" || options.id === "")) throw new TypeError("id must be a non-empty string");

    const same = options.id !== undefined
      ? this.#entries.find((e) => e.id === options.id)
      : options.dedupe ? this.#entries.find((e) => e.message === message && e.variant === variant) : undefined;
    const duration = toastDuration(variant, action !== undefined, requested, this.#hooks.settings(), this.#hooks.defaults());

    if (same) {
      Object.assign(same, { message, variant, action, duration, progress, onDismiss: options.onDismiss });
      this.#restart(same);
      this.#settle();
      this.#hooks.notify("updated", this.#view(same));
      return same.id;
    }
    const entry: Entry = {
      id: options.id ?? `toast-${++this.#ids}`, message, variant, action, duration, progress, onDismiss: options.onDismiss,
      remaining: duration ?? 0, startedAt: undefined, handle: undefined,
    };
    this.#entries.push(entry);
    this.#settle();
    this.#hooks.notify("shown", this.#view(entry));
    return entry.id;
  }

  /** Patches a toast. A patch of `progress` alone leaves its timer running. Returns false for an unknown id. */
  update(id: string, patch: ToastPatch): boolean {
    const entry = this.#entries.find((e) => e.id === id);
    if (!entry) return false;
    let restart = false;
    if (patch.message !== undefined) {
      if (typeof patch.message !== "string") throw new TypeError("message must be a string");
      entry.message = patch.message;
      restart = true;
    }
    if (patch.variant !== undefined) {
      entry.variant = validateToastVariant(patch.variant);
      restart = true;
    }
    if (patch.action !== undefined) {
      entry.action = patch.action === null ? undefined : validateToastAction(patch.action);
      restart = true;
    }
    if (patch.progress !== undefined) entry.progress = patch.progress === null ? undefined : validateToastProgress(patch.progress);
    if (patch.duration !== undefined) restart = true;
    if (restart) {
      const requested = patch.duration === undefined ? undefined : validateToastDuration(patch.duration);
      entry.duration = toastDuration(entry.variant, entry.action !== undefined, requested, this.#hooks.settings(), this.#hooks.defaults());
      this.#restart(entry);
    }
    this.#settle();
    this.#hooks.notify("updated", this.#view(entry));
    return true;
  }

  /** Removes a toast and tells its `onDismiss` why. Returns false for an unknown id. */
  dismiss(id: string, reason: ToastDismissReason): boolean {
    const at = this.#entries.findIndex((e) => e.id === id);
    if (at < 0) return false;
    const [entry] = this.#entries.splice(at, 1);
    this.#hooks.clock.clear(entry!.handle);
    this.#settle();
    this.#hooks.notify("dismissed", view(entry!, false), reason);
    entry!.onDismiss?.(reason);
    return true;
  }

  dismissAll(reason: ToastDismissReason): void {
    for (const id of this.#entries.map((e) => e.id)) this.dismiss(id, reason);
  }

  /** The newest toast on screen. */
  newestShown(): ToastItem | undefined {
    const shown = this.items().filter((i) => i.shown);
    return shown[shown.length - 1];
  }

  /** Adds or releases one hold; any hold pauses every timer. A hold the host switched off is ignored. */
  hold(source: ToastHold, on: boolean): void {
    if (on && !this.#hooks.settings().hold.has(source)) return;
    if (on === this.#holds.has(source)) return;
    const held = this.held;
    if (on) this.#holds.add(source);
    else this.#holds.delete(source);
    if (held === this.held) return;
    const shown = this.#shownSet();
    this.#entries.forEach((e) => {
      if (this.held) this.#pause(e);
      else if (shown.has(e) && e.duration !== null) {
        e.remaining = Math.max(e.remaining, RESUME_MS);
        this.#arm(e);
      }
    });
  }

  get held(): boolean {
    return this.#holds.size > 0;
  }

  /** Re-reads settings and defaults after a change: the stack size, or `autoDismiss`. */
  reconfigure(): void {
    const settings = this.#hooks.settings();
    for (const e of this.#entries) {
      if (!settings.autoDismiss && e.duration !== null) {
        this.#pause(e);
        e.duration = null;
      }
    }
    for (const hold of [...this.#holds]) if (!settings.hold.has(hold)) this.hold(hold, false);
    this.#settle();
  }

  #view(entry: Entry): ToastItem {
    return view(entry, this.#shownSet().has(entry));
  }

  #restart(e: Entry): void {
    this.#pause(e);
    e.remaining = e.duration ?? 0;
    this.#arm(e);
  }

  /** Starts timers for what just became shown, stops them for what left, and reports the list. */
  #settle(): void {
    const shown = this.#shownSet();
    this.#entries.forEach((e) => (shown.has(e) ? this.#arm(e) : this.#pause(e)));
    this.#hooks.changed(this.items());
  }

  /**
   * The first `max` toasts in arrival order, except that toasts which do not
   * time out take at most `max - 1` places, so a short-lived toast (an Undo)
   * always finds a free one. A further sticky toast queues. With a single
   * place that reserve is dropped: the place goes to whoever is first.
   */
  #shownSet(): Set<Entry> {
    const max = this.#hooks.settings().max;
    const stickyLimit = max === 1 ? 1 : max - 1;
    const shown = new Set<Entry>();
    let sticky = 0;
    for (const e of this.#entries) {
      if (shown.size >= max) break;
      if (e.duration === null) {
        if (sticky >= stickyLimit) continue;
        sticky++;
      }
      shown.add(e);
    }
    return shown;
  }

  #pause(e: Entry): void {
    if (e.startedAt === undefined) return;
    this.#hooks.clock.clear(e.handle);
    e.handle = undefined;
    e.remaining = Math.max(0, e.remaining - (this.#hooks.clock.now() - e.startedAt));
    e.startedAt = undefined;
  }

  #arm(e: Entry): void {
    if (e.startedAt !== undefined || e.duration === null || this.held) return;
    e.startedAt = this.#hooks.clock.now();
    e.handle = this.#hooks.clock.set(() => {
      e.handle = undefined;
      e.startedAt = undefined;
      this.dismiss(e.id, "timeout");
    }, e.remaining);
  }
}

function view(e: Entry, shown: boolean): ToastItem {
  return { id: e.id, message: e.message, variant: e.variant, action: e.action, duration: e.duration, progress: e.progress, shown };
}
