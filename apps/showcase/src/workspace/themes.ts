// The demo's themes: Lamplight is the default identity (plain :root), the
// others are named on the root. The choice is kept per browser. An unlisted
// theme isn't in the menu and isn't remembered; `?identity=` still applies it.

export const THEMES = [
  { id: "lamplight", label: "Lamplight", listed: true },
  { id: "harbour", label: "Harbour", listed: true },
] as const;

/** The themes the menu offers. */
export const LISTED = THEMES.filter((t) => t.listed);

export type Theme = (typeof THEMES)[number]["id"];
const KEY = "aster-demo-identity";

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return LISTED.some((t) => t.id === v) ? (v as Theme) : "lamplight";
  } catch {
    return "lamplight";
  }
}

export function currentTheme(): Theme {
  const v = document.documentElement.dataset.identity;
  return THEMES.some((t) => t.id === v) ? (v as Theme) : "lamplight";
}

/** Names the theme on the root; an unknown name leaves Lamplight. */
export function applyTheme(id: string): void {
  const root = document.documentElement;
  if (id === "lamplight" || !THEMES.some((t) => t.id === id)) delete root.dataset.identity;
  else root.dataset.identity = id;
}

export function chooseTheme(id: Theme): void {
  applyTheme(id);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not remembered; it still applies now.
  }
}
