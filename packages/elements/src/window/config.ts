/** The parts of a floating window's chrome it draws. Omitted fields keep their defaults. */
export interface WindowChrome {
  /** The title bar: heading, move control and window controls. Default `true`. */
  readonly header?: boolean;
  /** The heading inside the title bar. Default `true`; a hidden heading still names the window. */
  readonly title?: boolean;
  /** The Close control. Default `true`. */
  readonly close?: boolean;
  /** The Minimize control. Default: shown for managed windows. */
  readonly minimize?: boolean;
  /** The Maximize/Restore control. Default: shown for managed windows. */
  readonly maximize?: boolean;
  /** Pointer and keyboard resizing. Default `true`. */
  readonly resizer?: boolean;
  /** The Collapse/Expand control that folds the window to its title bar. Default `false`. */
  readonly fold?: boolean;
  /** The footer region at the bottom of the window. Default `false`; setting `footer` turns it on. */
  readonly footer?: boolean;
  /** The status region at the bottom of the window. Default `false`; setting `status` turns it on. */
  readonly statusBar?: boolean;
}

export type WindowState = "normal" | "maximized" | "minimized";
export interface WindowBounds { x: number; y: number; width: number; height: number }
/** An edge of the window's area. Horizontally, `start` and `end` follow text direction. */
export type WindowSide = "start" | "end";
/** The edges a window sits flush against, kept when its area resizes. An omitted axis is free. */
export interface WindowAnchor { readonly x?: WindowSide; readonly y?: WindowSide }
export interface WindowPlacement { state: WindowState; bounds?: WindowBounds; restoreMaximized?: boolean; folded?: boolean; anchor?: WindowAnchor }

/** [[object:WindowChrome]] with every default filled in. */
export interface ResolvedWindowChrome {
  readonly header: boolean;
  readonly title: boolean;
  readonly close: boolean;
  readonly minimize: boolean;
  readonly maximize: boolean;
  readonly resizer: boolean;
  readonly fold: boolean;
  readonly footer: boolean;
  readonly statusBar: boolean;
}

/** Minimize and maximize stay managed-window chrome unless the host overrides them. */
export function resolveWindowChrome(chrome: WindowChrome, managed: boolean): ResolvedWindowChrome {
  return {
    header: chrome.header ?? true,
    title: chrome.title ?? true,
    close: chrome.close ?? true,
    minimize: chrome.minimize ?? managed,
    maximize: chrome.maximize ?? managed,
    resizer: chrome.resizer ?? true,
    fold: chrome.fold ?? false,
    footer: chrome.footer ?? false,
    statusBar: chrome.statusBar ?? false,
  };
}

/** A placement is rejected atomically; bounds are finite and positive. */
export function parseWindowPlacement(value: unknown): WindowPlacement {
  const placement = value as WindowPlacement | undefined;
  if (!placement || !["normal", "maximized", "minimized"].includes(placement.state)) throw new TypeError("Invalid window state");
  const b = placement.bounds;
  if (b && (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0)) throw new TypeError("Invalid window bounds");
  const a = placement.anchor;
  const side = (v: unknown) => v === undefined || v === "start" || v === "end";
  if (a !== undefined && (!a || typeof a !== "object" || !side(a.x) || !side(a.y))) throw new TypeError("Invalid window anchor");
  const anchor = a && (a.x || a.y) ? { ...(a.x ? { x: a.x } : {}), ...(a.y ? { y: a.y } : {}) } : undefined;
  return {
    state: placement.state,
    ...(b ? { bounds: { x: b.x, y: b.y, width: b.width, height: b.height } } : {}),
    restoreMaximized: placement.restoreMaximized === true,
    folded: placement.folded === true,
    ...(anchor ? { anchor } : {}),
  };
}

/** The rectangle a window may occupy, in viewport pixels. */
export interface WindowLimits { left: number; top: number; right: number; bottom: number }

/** Keeps a window's top-left inside `limits`, never computing layout of its own. */
export function clampWindow(at: { x: number; y: number }, size: { width: number; height: number }, limits: WindowLimits): { x: number; y: number } {
  return {
    x: Math.max(limits.left, Math.min(at.x, limits.right - size.width)),
    y: Math.max(limits.top, Math.min(at.y, limits.bottom - size.height)),
  };
}

/** A physical edge on one axis: the low (left or top) or high (right or bottom) one. */
export type WindowEdge = "low" | "high";

/** Moves the anchored axes flush against their edges; free axes keep `at`. */
export function anchorWindow(at: { x: number; y: number }, size: { width: number; height: number }, limits: WindowLimits,
  edges: { x?: WindowEdge; y?: WindowEdge }): { x: number; y: number } {
  const flush = (pos: number, length: number, low: number, high: number, edge: WindowEdge | undefined) =>
    edge === "low" ? low : edge === "high" ? high - length : pos;
  return {
    x: flush(at.x, size.width, limits.left, limits.right, edges.x),
    y: flush(at.y, size.height, limits.top, limits.bottom, edges.y),
  };
}

/**
 * The edges within `distance` of the window on each axis, nearest first.
 * `toward` limits an axis to the edge it moves toward: negative for low,
 * positive for high, zero for neither. Omitted, both edges are candidates.
 */
export function snapEdges(at: { x: number; y: number }, size: { width: number; height: number }, limits: WindowLimits,
  distance: number, toward: { x: number; y: number } = { x: Number.NaN, y: Number.NaN }): { x?: WindowEdge; y?: WindowEdge } {
  const snap = (pos: number, length: number, low: number, high: number, dir: number): WindowEdge | undefined => {
    const toLow = Math.abs(pos - low), toHigh = Math.abs(high - (pos + length));
    const lowOk = !(dir >= 0) && toLow <= distance, highOk = !(dir <= 0) && toHigh <= distance;
    if (lowOk && (!highOk || toLow <= toHigh)) return "low";
    return highOk ? "high" : undefined;
  };
  const x = snap(at.x, size.width, limits.left, limits.right, toward.x);
  const y = snap(at.y, size.height, limits.top, limits.bottom, toward.y);
  return { ...(x ? { x } : {}), ...(y ? { y } : {}) };
}

export function centerWindow(size: { width: number; height: number }, limits: WindowLimits): { x: number; y: number } {
  return {
    x: limits.left + (limits.right - limits.left - size.width) / 2,
    y: limits.top + (limits.bottom - limits.top - size.height) / 2,
  };
}
