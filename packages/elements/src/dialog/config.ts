/** A header appears when the dialog has a title, unless `header` says otherwise. */
export function dialogHeaderShown(title: string | undefined, header: boolean | undefined): boolean {
  return header ?? (title !== undefined && title !== "");
}

/** The close control belongs to the header and is off by default, preserving today's dialogs. */
export function dialogCloseShown(header: boolean, showCloseButton: boolean | undefined): boolean {
  return header && showCloseButton === true;
}
