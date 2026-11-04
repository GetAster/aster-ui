import type { View } from "../base/element.ts";

const MODIFIERS: Readonly<Record<string, string>> = {
  ctrl: "Control", control: "Control", "⌃": "Control",
  cmd: "Meta", command: "Meta", meta: "Meta", "⌘": "Meta",
  alt: "Alt", option: "Alt", "⌥": "Alt",
  shift: "Shift", "⇧": "Shift",
};

const NAMED: Readonly<Record<string, string>> = {
  space: "Space", enter: "Enter", escape: "Escape", esc: "Escape", tab: "Tab", backspace: "Backspace",
  delete: "Delete", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
  arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
};

/**
 * The `aria-keyshortcuts` value for a human shortcut hint ("Ctrl+S", "⌘K"),
 * or `undefined` when it isn't a keyboard shortcut this attribute can carry.
 */
export function ariaKeyshortcuts(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined;
  let text = shortcut.trim();
  const modifiers: string[] = [];
  // Apple-style hints prefix the key with symbols (⇧⌘K) instead of joining with "+".
  while (/^[⌘⌥⇧⌃]/.test(text)) {
    modifiers.push(MODIFIERS[text[0]!]!);
    text = text.slice(1).trim();
  }
  const parts = text.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return undefined;
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (!modifier) return undefined;
    modifiers.push(modifier);
  }
  const named = NAMED[key.toLowerCase()] ?? (/^F([1-9]|1[0-2])$/i.test(key) ? key.toUpperCase() : undefined);
  const last = named ?? (key.length === 1 && /\S/.test(key) ? key.toUpperCase() : undefined);
  return last ? [...modifiers, last].join("+") : undefined;
}

/** Whether a level reserves an icon cell, so labels line up across its items. */
export function hasMenuIcons(items: readonly object[]): boolean {
  return items.some((item) => (item as { readonly icon?: View }).icon !== undefined);
}
