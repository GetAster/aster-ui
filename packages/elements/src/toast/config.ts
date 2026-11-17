/** How urgent a toast is, and so how it is announced and whether it times out. */
export type ToastVariant = "info" | "success" | "warning" | "error" | "loading";
export const TOAST_VARIANTS: readonly ToastVariant[] = ["info", "success", "warning", "error", "loading"];

/** Why a toast left: its time ran out, its dismiss button, Escape, the API, or its action. */
export type ToastDismissReason = "timeout" | "button" | "escape" | "api" | "action";

/** What holds every timer: the pointer over the stack, focus inside it, a modal dialog, or the host. */
export type ToastHold = "hover" | "focus" | "modal" | "api";

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

/** What `show` takes beyond the message. */
export interface ToastOptions {
  /** Showing an id that exists replaces that toast and restarts its timer. */
  readonly id?: string;
  /** Default `"info"`. */
  readonly variant?: ToastVariant;
  readonly action?: ToastAction;
  /** Milliseconds, or `null` to stay until dismissed. Default by variant. */
  readonly duration?: number | null;
  /** A determinate bar, 0 to 1. */
  readonly progress?: number;
  /** Reuse a showing toast with the same message and variant. */
  readonly dedupe?: boolean;
  /** Called once with the reason the toast left. */
  readonly onDismiss?: (reason: ToastDismissReason) => void;
}

/** What `update` changes. `null` clears the action or the progress bar; a `null` duration means until dismissed. */
export interface ToastPatch {
  readonly message?: string;
  readonly variant?: ToastVariant;
  readonly action?: ToastAction | null;
  readonly duration?: number | null;
  readonly progress?: number | null;
}

/** Policy says may. */
export interface ToasterPolicy {
  /** Whether a toast may time out at all. Default `true`; `false` keeps every toast until dismissed. */
  readonly autoDismiss?: boolean;
  /** Whether Escape may dismiss a toast. Default `true`. */
  readonly dismissOnEscape?: boolean;
}

/** Features say how. */
export type ToasterFeature =
  | { readonly kind: "stack"; readonly max?: number }
  | { readonly kind: "hold"; readonly while?: readonly ToastHoldSource[] };

/** The holds a host can switch: the host's own `pause()` always applies. */
export type ToastHoldSource = "hover" | "focus" | "modal";

/** Which block edge the stack sits at: the top (`"start"`) or the bottom (`"end"`). */
export type ToastBlock = "start" | "end";
/** Where along the inline axis the stack sits; `"start"` and `"end"` follow the text direction. */
export type ToastInline = "start" | "center" | "end";

/** Chrome says shown. */
export interface ToasterChrome {
  /** Logical, so right-to-left flips it. Default `{ block: "end", inline: "center" }`. */
  readonly position?: { readonly block?: ToastBlock; readonly inline?: ToastInline };
  /** A variant icon on each toast. Default `true`. */
  readonly icon?: boolean;
  /** A dismiss button on every toast. Default `false`; a toast that does not time out always has one. */
  readonly dismissButton?: boolean;
}

export interface ToasterSettings {
  readonly autoDismiss: boolean;
  readonly dismissOnEscape: boolean;
  readonly max: number;
  readonly hold: ReadonlySet<ToastHold>;
  readonly block: ToastBlock;
  readonly inline: ToastInline;
  readonly icon: boolean;
  readonly dismissButton: boolean;
}

export const DEFAULT_DURATION = 6000;
export const DEFAULT_ACTION_DURATION = 10000;
export const DEFAULT_MAX_VISIBLE = 3;
/** A toast keeps at least this long once a hold lets go. */
export const RESUME_MS = 2000;
export const MAX_DURATION = 2_147_483_647;

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v));

function only(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`Unknown ${what} '${key}'`);
}

function bool(value: unknown, what: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") throw new TypeError(`${what} must be a boolean`);
  return value as boolean | undefined;
}

function choice<T extends string>(value: unknown, allowed: readonly T[], what: string): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) throw new TypeError(`${what} must be ${allowed.map((a) => `"${a}"`).join(", ")}`);
  return value as T;
}

export function validateToasterPolicy(value: unknown): ToasterPolicy {
  if (!plain(value)) throw new TypeError("policy must be a plain object");
  only(value, ["autoDismiss", "dismissOnEscape"], "policy key");
  bool(value.autoDismiss, "policy.autoDismiss");
  bool(value.dismissOnEscape, "policy.dismissOnEscape");
  return Object.freeze({ ...value }) as ToasterPolicy;
}

export function validateToasterFeatures(value: unknown): readonly ToasterFeature[] {
  if (!Array.isArray(value)) throw new TypeError("features must be an array");
  const seen = new Set<string>();
  const result = value.map((entry, i): ToasterFeature => {
    if (!plain(entry)) throw new TypeError(`features[${i}] must be a plain object`);
    const kind = entry.kind;
    if (typeof kind !== "string" || seen.has(kind)) throw new TypeError(`features[${i}].kind must be "stack" or "hold", once each`);
    seen.add(kind);
    switch (kind) {
      case "stack": {
        only(entry, ["kind", "max"], "stack option");
        const max = entry.max;
        if (max !== undefined && (typeof max !== "number" || !Number.isSafeInteger(max) || max < 1)) throw new TypeError("stack.max must be a positive integer");
        return Object.freeze({ ...entry }) as ToasterFeature;
      }
      case "hold": {
        only(entry, ["kind", "while"], "hold option");
        const sources = entry.while;
        if (sources !== undefined && (!Array.isArray(sources) || sources.some((s) => !["hover", "focus", "modal"].includes(s as string)))) {
          throw new TypeError('hold.while must be a list of "hover", "focus" and "modal"');
        }
        return Object.freeze({ ...entry, ...(sources ? { while: Object.freeze([...sources]) } : {}) }) as ToasterFeature;
      }
      default:
        throw new TypeError(`Unknown toaster feature '${kind}'`);
    }
  });
  return Object.freeze(result);
}

export function validateToasterChrome(value: unknown): ToasterChrome {
  if (!plain(value)) throw new TypeError("chrome must be a plain object");
  only(value, ["position", "icon", "dismissButton"], "chrome key");
  bool(value.icon, "chrome.icon");
  bool(value.dismissButton, "chrome.dismissButton");
  const position = value.position;
  if (position !== undefined) {
    if (!plain(position)) throw new TypeError("chrome.position must be a plain object");
    only(position, ["block", "inline"], "position key");
    choice(position.block, ["start", "end"], "position.block");
    choice(position.inline, ["start", "center", "end"], "position.inline");
  }
  return Object.freeze({ ...value, ...(position ? { position: Object.freeze({ ...(position as object) }) } : {}) }) as ToasterChrome;
}

export function validateToastDuration(value: unknown, what = "duration"): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_DURATION) throw new RangeError(`${what} must be null or an integer from 0 to ${MAX_DURATION}`);
  return value;
}

export function validateToastProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("progress must be a number from 0 to 1");
  return value;
}

export function validateToastVariant(value: unknown): ToastVariant {
  if (!TOAST_VARIANTS.includes(value as ToastVariant)) throw new TypeError(`variant must be ${TOAST_VARIANTS.map((v) => `"${v}"`).join(", ")}`);
  return value as ToastVariant;
}

export function validateToastAction(value: unknown): ToastAction {
  if (!plain(value) || typeof value.label !== "string" || value.label === "" || typeof value.run !== "function") throw new TypeError("action needs a label and a run function");
  return value as unknown as ToastAction;
}

/** Folds policy, features, chrome and the sugar into the settings the queue and view read. */
export function resolveToaster(policy: ToasterPolicy, features: readonly ToasterFeature[], chrome: ToasterChrome): ToasterSettings {
  const stack = features.find((f): f is Extract<ToasterFeature, { kind: "stack" }> => f.kind === "stack");
  const hold = features.find((f): f is Extract<ToasterFeature, { kind: "hold" }> => f.kind === "hold");
  const sources: readonly ToastHoldSource[] = hold?.while ?? ["hover", "focus", "modal"];
  return Object.freeze({
    autoDismiss: policy.autoDismiss ?? true,
    dismissOnEscape: policy.dismissOnEscape ?? true,
    max: stack?.max ?? DEFAULT_MAX_VISIBLE,
    hold: new Set<ToastHold>([...sources, "api"]),
    block: chrome.position?.block ?? "end",
    inline: chrome.position?.inline ?? "center",
    icon: chrome.icon ?? true,
    dismissButton: chrome.dismissButton ?? false,
  });
}

/** Error and loading toasts wait to be dismissed or updated; the rest time out. */
export function timesOut(variant: ToastVariant): boolean {
  return variant !== "error" && variant !== "loading";
}

/**
 * How long a toast stays, in milliseconds, or `null` for until dismissed. The
 * host's policy can only restrict: with `autoDismiss` off nothing times out,
 * whatever a toast asks for.
 */
export function toastDuration(
  variant: ToastVariant,
  hasAction: boolean,
  requested: number | null | undefined,
  settings: ToasterSettings,
  defaults: { readonly duration: number; readonly actionDuration: number },
): number | null {
  if (!settings.autoDismiss) return null;
  if (requested !== undefined) return requested;
  if (!timesOut(variant)) return null;
  return hasAction ? defaults.actionDuration : defaults.duration;
}
