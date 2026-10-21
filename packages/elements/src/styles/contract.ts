/**
 * The token contract: every custom property an identity must define, by
 * role. Elements and apps style themselves only through these, so an
 * identity is a complete set of values and nothing else.
 *
 * A dark scheme (`:root[data-scheme="dark"]`) may override any of them and
 * needs to define none.
 */
export const TOKENS = {
  type: [
    "font-ui", "font-figure", "font-size", "line", "weight", "weight-strong", "weight-label",
    "figure-settings", "title-settings", "heading-settings", "prose-settings",
  ],
  surfaces: ["page", "surface", "sunk", "pane", "backdrop", "frame", "texture", "texture-blend", "texture-opacity"],
  text: ["text", "text-2", "text-3"],
  /** `mark-ring` outlines identity dots and avatars so a pale hue still shows. */
  edges: ["rule", "rule-2", "mark-ring"],
  /** Accent acts (buttons, links, focus); indicator only marks where to look (the caret). */
  accent: ["accent", "accent-hi", "accent-soft", "on-accent", "accent-sheen", "focus", "focus-offset", "indicator"],
  status: ["positive", "negative", "caution"],
  /** Identity colours take their hue from data and lightness and chroma from here. */
  identity: ["identity-l", "identity-c"],
  /** `press` is the inset shadow colour of a pressed primary button. */
  elevation: ["shadow", "highlight", "ring", "e1", "e2", "e3", "well", "scrim", "press"],
  shape: ["r-ctl", "r-card", "r-pop", "r-dialog"],
  motion: ["ease", "t-morph", "t-ink", "t-micro", "t-caret", "t-scheme"],
  toast: ["toast-bg", "toast-text", "toast-action", "toast-mark"],
  /** Lamplight's lamp, which other identities set to something neutral; `lamp-bulb` is the glow round the switch's bulb. */
  light: ["lamp", "glow", "lamp-bulb"],
} as const;

export const TOKEN_NAMES: readonly string[] = Object.values(TOKENS).flat().map((t) => `--aster-${t}`);

/**
 * Sizes that follow density rather than identity: control height, a tighter
 * control for grids, vertical padding of grid cells and listbox rows, of
 * single-line rows, and of panels and bars, and the gap between fields. `base.css` defines them for each density.
 */
export const DENSITY = ["ctl", "ctl-tight", "pad-y", "row-y", "pad", "gap"] as const;
export const DENSITIES = ["compact", "standard", "comfortable"] as const;
export const DENSITY_NAMES: readonly string[] = DENSITY.map((t) => `--aster-${t}`);
