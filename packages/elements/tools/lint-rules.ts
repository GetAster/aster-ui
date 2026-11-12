// The catalogue aster-lint checks against: native markup that Aster already
// provides as an element, by rule id. Every `entries` name is a reference
// entry; test/lint.test.ts keeps them in step with docs/reference.

export interface ElementRule {
  readonly id: string;
  /** The Aster elements to use instead, in order of fit. */
  readonly use: readonly string[];
  /** Reference entries for those elements, such as `class:Check`. */
  readonly entries: readonly string[];
}

const rule = (id: string, use: readonly string[], entries: readonly string[]): ElementRule => Object.freeze({ id, use, entries });

export const ELEMENT_RULES = {
  button: rule("native-button", ["aster-button", "aster-command-bar", "aster-menu"], ["class:Button", "class:CommandBar", "class:Menu"]),
  checkbox: rule("native-checkbox", ["aster-check", "aster-switch"], ["class:Check", "class:Switch"]),
  input: rule("native-input", ["aster-field", "aster-number-field", "aster-date", "aster-picker"], ["class:Field", "class:NumberField", "class:DateField", "class:Picker"]),
  textarea: rule("native-textarea", ["aster-field"], ["class:Field"]),
  select: rule("native-select", ["aster-select", "aster-choice"], ["class:Select", "class:Choice"]),
  table: rule("native-table", ["aster-grid"], ["class:Grid"]),
  dialog: rule("native-dialog", ["aster-dialog"], ["class:Dialog"]),
  details: rule("native-details", ["aster-disclosure", "aster-section", "aster-accordion"], ["class:Disclosure", "class:Section", "class:Accordion"]),
  progress: rule("native-progress", ["aster-progress-status"], ["class:ProgressStatus"]),
  form: rule("native-form", ["aster-form"], ["class:Form"]),
} as const;

/** Input types that are a button, a checkbox or typed text; others (radio, range, file, hidden, colour) have no Aster element. */
const INPUT_KINDS: Readonly<Record<string, keyof typeof ELEMENT_RULES>> = {
  button: "button", submit: "button", reset: "button", checkbox: "checkbox",
  text: "input", search: "input", email: "input", tel: "input", url: "input", password: "input",
  number: "input", date: "input", "datetime-local": "input", time: "input", month: "input", week: "input",
};

/** Hand-made ARIA widgets that Aster provides. */
export const ROLE_RULES: Readonly<Record<string, ElementRule>> = Object.freeze(Object.fromEntries(([
  // A host's own panel takes role="tabpanel" (class:Tabs), so only the tabs themselves count.
  [["tablist", "tab"], ["aster-tabs"], ["class:Tabs"]],
  [["menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio"], ["aster-menu"], ["class:Menu"]],
  [["listbox", "option"], ["aster-listbox", "aster-select"], ["class:Listbox", "class:Select"]],
  [["combobox"], ["aster-select", "aster-picker"], ["class:Select", "class:Picker"]],
  [["tree", "treeitem", "treegrid"], ["aster-tree-navigator", "aster-tree-picker", "aster-grid"], ["class:TreeNavigator", "class:TreePicker", "class:Grid"]],
  [["grid", "gridcell"], ["aster-grid"], ["class:Grid"]],
  [["dialog", "alertdialog"], ["aster-dialog"], ["class:Dialog"]],
  [["switch"], ["aster-switch"], ["class:Switch"]],
  [["toolbar"], ["aster-command-bar"], ["class:CommandBar"]],
] as const).flatMap(([roles, use, entries]) => roles.map(role => [role, rule(`role-${role}`, use, entries)]))));

const TAGS: ReadonlySet<string> = new Set(["button", "textarea", "select", "table", "dialog", "details", "progress", "form"]);

/** The rule for a native element, given its lowercase tag and `type` (undefined when absent or dynamic). */
export function elementRule(tag: string, type: string | undefined): ElementRule | undefined {
  if (tag === "input") {
    const kind = INPUT_KINDS[type ?? "text"];
    return kind ? ELEMENT_RULES[kind] : undefined;
  }
  return TAGS.has(tag) ? ELEMENT_RULES[tag as keyof typeof ELEMENT_RULES] : undefined;
}

export const CSS_RULES = Object.freeze({
  restyle: "css-restyle",
  colour: "css-colour",
  font: "css-font",
  token: "css-token",
});

/** Properties that place an Aster element in the page's layout rather than restyle it. */
export const LAYOUT_PROPERTIES: ReadonlySet<string> = new Set([
  "display", "position", "inset", "top", "right", "bottom", "left", "inset-block", "inset-inline",
  "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end", "z-index",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "inline-size", "block-size", "min-inline-size", "min-block-size", "max-inline-size", "max-block-size",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "margin-block", "margin-inline",
  "margin-block-start", "margin-block-end", "margin-inline-start", "margin-inline-end",
  "flex", "flex-grow", "flex-shrink", "flex-basis", "order", "align-self", "justify-self", "place-self",
  "grid-area", "grid-column", "grid-row", "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
  "overflow", "overflow-x", "overflow-y", "contain", "container", "container-type", "container-name", "visibility", "aspect-ratio",
]);
