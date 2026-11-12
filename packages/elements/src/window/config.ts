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
export interface WindowPlacement { state: WindowState; bounds?: WindowBounds; restoreMaximized?: boolean; folded?: boolean }

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
  return {
    state: placement.state,
    ...(b ? { bounds: { x: b.x, y: b.y, width: b.width, height: b.height } } : {}),
    restoreMaximized: placement.restoreMaximized === true,
    folded: placement.folded === true,
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

export function centerWindow(size: { width: number; height: number }, limits: WindowLimits): { x: number; y: number } {
  return {
    x: limits.left + (limits.right - limits.left - size.width) / 2,
    y: limits.top + (limits.bottom - limits.top - size.height) / 2,
  };
}
