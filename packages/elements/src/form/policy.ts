/**
 * Restrictions on this form's controls. They combine with field restrictions
 * and shared model state; no host can relax another restriction.
 */
export interface FormPolicy {
  /** Restricts every field in this host to read-only. */
  readonly readOnly?: boolean;
  /** Disables every field in this host. */
  readonly disabled?: boolean;
}

/** Which presentation surfaces the form shows, and how it lays them out. */
export interface FormChrome {
  /** Columns for sections without their own `columns`. Default `2`. */
  readonly columns?: number;
  /** Labels above their controls (`"top"`, the default) or beside them (`"start"`). */
  readonly titleOrientation?: "top" | "start";
  /** Draw each error under its field. Default `true`; false leaves the error summary as the only surface. */
  readonly showInlineErrors?: boolean;
  /** List the errors above the sections, each a button that focuses its field. Default `false`. */
  readonly errorSummary?: boolean;
  /** Move focus to the first invalid field when validation first finds errors. Default `false`. */
  readonly autoFocus?: boolean;
}

export const DEFAULT_FORM_COLUMNS = 2;

export function formColumns(chrome: FormChrome): number {
  return chrome.columns ?? DEFAULT_FORM_COLUMNS;
}

export function titleOrientation(chrome: FormChrome): "top" | "start" {
  return chrome.titleOrientation ?? "top";
}

export function inlineErrorsShown(chrome: FormChrome): boolean {
  return chrome.showInlineErrors !== false;
}

export function errorSummaryShown(chrome: FormChrome): boolean {
  return chrome.errorSummary === true;
}

export function autoFocusOnError(chrome: FormChrome): boolean {
  return chrome.autoFocus === true;
}
