# Themes

Every element styles itself only through `--aster-` custom properties: the
**token contract**. A theme (an *identity*) is one complete set of values for
those tokens, and nothing else: no selectors for elements, no overrides of
their rules. Two ship: **Lamplight** (warm, lit, serif figures) and **Harbour** (cool, rounded, calm), which
was written from this guide alone. The guide is enough to write another.

## A theme file

```css
@layer aster.identity {
  :root[data-identity="harbour"] {
    --aster-font-ui: "Inter", system-ui, sans-serif;
    /* … every token in the tables below … */
    color-scheme: light;
  }

  :root[data-identity="harbour"][data-scheme="dark"] {
    /* only the tokens that change in the dark */
    color-scheme: dark;
  }
}
```

- **The light rule defines every token.** The checker lists any that are
  missing.
- **The dark rule overrides only what changes.** Colours mostly; type, shape
  and motion usually stay. Dark is its own design, not an inversion: surfaces
  get lighter as they rise (page darkest, surface lighter), and the accent
  gets lighter to keep its contrast. In the tables below, an empty dark cell
  means the light value applies.
- **`var()` resolves where it's used.** A token defined as
  `var(--aster-accent)`, or built on one with `oklch(from var(…) …)`, follows
  that token into the dark scheme without being restated. Lamplight restates
  `e1` to `e3` in the dark only because their shadow strengths change.
- **Put it in the `aster.identity` layer.** The layers run `aster.identity`,
  `aster.base`, `aster.elements`, `app`, so a theme never outranks an
  element's own rules and an app's styles outrank both.
- **Any CSS colour syntax works**, and a token can derive from another:
  `--aster-focus: oklch(from var(--aster-accent) l c h / .7)`. The checker
  evaluates hex, `rgb()`, `oklch()` (relative too), `color-mix(in srgb, …)`
  and `var()`; anything else it reports as unchecked, not wrong.
- **Fonts are the page's job.** A theme names typefaces and the page loads
  them, so end every stack with a generic family (`system-ui, sans-serif`).
  Weights between the named ones (450) suit variable fonts; system fonts
  round them. Line heights from 1.35 to 1.6 fit the layouts, and body sizes
  from 12px to 15px fit the controls, whose heights come from density.
- **Shadows are tokens too.** `e1` to `e3` are whole `box-shadow` values,
  usually starting with `var(--aster-ring)` (and `var(--aster-highlight)` in
  a lit theme): a lit theme layers soft shadows tinted from `shadow`
  (Lamplight), a flat one uses the hairline ring alone and keeps a real
  shadow only for floating things. Avatars also use `highlight` on
  its own, so a flat theme sets it to `0 0 #0000`.
- **Identity colours** (people's and projects' dots and avatars) take their
  hue from data and `identity-l` and `identity-c` from the theme. Keep them
  mid-light and moderately saturated (about 58–70% and .1) so every hue reads
  against `surface`; `mark-ring` outlines them for the palest hues. Dark
  usually raises the lightness.
- **`text-3` may equal `text-2`**. It's the quietest text
  (column headers, figure labels, timestamps), but still text people read,
  so it needs 4.5:1 like the others; a theme needn't have a third tier.
- **The lamp is Lamplight's.** Another theme sets `glow` to `0`,
  `lamp-bulb` to `transparent`, and `backdrop` and `frame` to plain `page`
  and `surface`.

## Where a theme lives

A theme is one CSS file the page links. In this repository the themes live
in `packages/elements/src/styles/`; `bun run site` copies them to
`lib/themes/` beside `aster-ui.css`, and the demo imports them in
`apps/showcase/src/workspace/styles.css` and lists them in `apps/showcase/src/workspace/themes.ts`
for its theme menu.

## Loading a theme

Link the theme before `aster-ui.css`, then name it on the root:

```html
<link rel="stylesheet" href="lib/themes/harbour.css">
<link rel="stylesheet" href="lib/aster-ui.css">
<html data-identity="harbour">
```

`data-scheme="dark"` on the root picks the dark scheme, and `data-density`
(`compact`, `standard`, `comfortable`) the density. Density belongs to the
person, not the theme: its tokens (`--aster-ctl`, `--aster-ctl-tight`,
`--aster-pad-y`, `--aster-row-y`, `--aster-pad`, `--aster-gap`) come from `aster-ui.css`, and a theme
doesn't set them.

Lamplight is the default identity: its rule is plain `:root`, so a page
with no `data-identity` gets it. A theme that should be the default can do
the same.

## Checking a theme

```sh
bun run theme-check path/to/harbour.css   # in this repository
bunx aster-theme-check path/to/harbour.css   # where @getaster/elements is installed
```

For each identity in the file, in both schemes, it checks:

1. **Every token is defined**, and none is unknown (a misspelt token would
   silently fall back to another theme's value).
2. **Contrast**, by WCAG 2: 4.5:1 for text, 3:1 for marks, focus and
   indicators. Translucent colours are composited over what they sit on.

| Foreground | On | At least |
|---|---|---|
| `text` | `surface`, `page`, `sunk`, `accent-soft` | 4.5:1 |
| `text-2` | `surface`, `sunk`, `page`, `accent-soft` | 4.5:1 |
| `text-3` | `surface`, `page`, `accent-soft` | 4.5:1 |
| `accent` | `surface` | 4.5:1 |
| `on-accent` | `accent`, `accent-hi` | 4.5:1 |
| `negative` | `surface` | 4.5:1 |
| `positive`, `caution` | `surface` | 3:1 |
| `focus`, `indicator` | `surface` | 3:1 |
| `toast-text`, `toast-action` | `toast-bg` | 4.5:1 |

It exits with 1 if anything fails, so it can run in CI. Only these colour
pairs are measured; the other tokens (shadows, `scrim`, `press`,
`mark-ring`, `toast-mark`, type, shape and motion) are checked for presence
and spelling. The demo's browser tests run axe over its screens in each
theme, which measures the text as it's actually drawn.

## Starting from a palette

1. Copy the theme closest in spirit: Harbour for a cool, rounded look,
   Lamplight for a lit, layered one.
2. Set the surfaces from your neutrals: `page` the darkest in light,
   `surface` the lightest, `sunk` between (inside fields), `pane` for the
   sidebar.
3. Set `text`, `text-2` and `text-3` from your darkest neutrals, and check.
4. Choose one accent that acts (buttons, links, selection). A second brand
   colour can be the `indicator`, which only marks where to look.
5. Run the checker, adjust lightness until it passes, then do the dark rule
   the same way.
6. Look at every screen in both schemes; the checker can't judge taste.

## The tokens

<!-- tokens: generated by packages/elements/tools/theme-guide.ts -->

### Type

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-font-ui` | Typeface for everything but figures. | `"Bricolage Grotesque Variable", "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif` |  | `ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif` |  |
| `--aster-font-figure` | Typeface for figures (amounts, counts) and page titles. | `"Fraunces Variable", "Fraunces", ui-serif, Georgia, serif` |  | `ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif` |  |
| `--aster-font-size` | Body text size; other sizes are set relative to the layout, not to this. | `13px` |  | `14px` |  |
| `--aster-line` | Body line height. | `1.45` |  | `1.5` |  |
| `--aster-weight` | Body text weight. | `450` |  | `420` |  |
| `--aster-weight-strong` | Emphasis: the current navigation item, a chosen option. | `560` |  | `600` |  |
| `--aster-weight-label` | Field labels, column headers, small headings. | `600` |  | `600` |  |
| `--aster-figure-settings` | `font-variation-settings` for figures; `normal` for none. | `"SOFT" 30, "WONK" 1` |  | `normal` |  |
| `--aster-title-settings` | `font-variation-settings` for page titles. | `"opsz" 144, "SOFT" 30, "WONK" 1` |  | `normal` |  |
| `--aster-heading-settings` | `font-variation-settings` for section headings. | `"opsz" 96, "SOFT" 30, "WONK" 1` |  | `normal` |  |
| `--aster-prose-settings` | `font-variation-settings` for long text such as notes. | `"opsz" 24, "SOFT" 50, "WONK" 0` |  | `normal` |  |

### Surfaces

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-page` | The canvas behind the app's frame. | `oklch(95.2% .006 75)` | `oklch(19.5% .009 70)` | `oklch(94% .012 245)` | `oklch(18.5% .022 258)` |
| `--aster-surface` | Cards, panels, popovers, menus and dialogs. | `oklch(98.8% .004 80)` | `oklch(24.5% .01 72)` | `oklch(99% .004 245)` | `oklch(25% .026 257)` |
| `--aster-sunk` | Inside fields and wells: below the surface. | `oklch(96.6% .006 76)` | `oklch(21.8% .009 70)` | `oklch(96.4% .008 245)` | `oklch(21.5% .024 258)` |
| `--aster-pane` | The sidebar and side panes. | `oklch(93.6% .008 74)` | `oklch(21.5% .009 70)` | `oklch(92% .014 247)` | `oklch(21.5% .024 258)` |
| `--aster-backdrop` | The body's background: `page`, or a gradient over it. | `radial-gradient(115% 75% at 10% -12%, oklch(from var(--aster-lamp) l c h / calc(var(--aster-glow) * .9)), transparent 62%), var(--aster-page)` |  | `var(--aster-page)` |  |
| `--aster-frame` | The app frame's background: `surface`, or a gradient over it. | `radial-gradient(70% 55% at 0% 0%, oklch(from var(--aster-lamp) l c h / calc(var(--aster-glow) * .55)), transparent 70%), var(--aster-surface)` |  | `var(--aster-surface)` |  |
| `--aster-texture` | An image laid over everything (Lamplight's grain), or `none`. | `url("data:image/svg+xml,…") (an SVG noise filter)` |  | `none` |  |
| `--aster-texture-blend` | The texture's `mix-blend-mode`. | `multiply` | `overlay` | `normal` |  |
| `--aster-texture-opacity` | The texture's opacity; `0` with no texture. | `.055` | `.07` | `0` |  |

### Text

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-text` | Body text. 4.5:1 on `surface`, `page`, `sunk` and `accent-soft`. | `oklch(25% .018 60)` | `oklch(92.5% .012 85)` | `oklch(26% .035 258)` | `oklch(93% .012 245)` |
| `--aster-text-2` | Secondary text: labels, column headers, hints. 4.5:1 on `surface`, `sunk` and `page`. | `oklch(46% .016 62)` | `oklch(72% .012 80)` | `oklch(46% .03 255)` | `oklch(75% .02 250)` |
| `--aster-text-3` | Quiet text: column headers, figure labels, timestamps, placeholders. 4.5:1 on `surface`, `page` and `accent-soft`. | `oklch(53% .013 66)` | `oklch(68.5% .012 78)` | `oklch(52.5% .025 252)` | `oklch(71% .022 252)` |

### Edges

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-rule` | Borders and dividers. | `oklch(32% .025 60 / .15)` | `oklch(95% .02 85 / .1)` | `oklch(40% .04 255 / .16)` | `oklch(90% .03 250 / .14)` |
| `--aster-rule-2` | Fainter dividers, such as between rows. | `oklch(32% .025 60 / .08)` | `oklch(95% .02 85 / .055)` | `oklch(40% .04 255 / .08)` | `oklch(90% .03 250 / .07)` |
| `--aster-mark-ring` | The hairline round identity dots and avatars, so a pale hue still shows. | `oklch(0% 0 0 / .2)` |  | `oklch(0% 0 0 / .18)` |  |

### Accent

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-accent` | The colour that acts: primary buttons, links, the selection. 4.5:1 on `surface`. | `oklch(47% .095 168)` | `oklch(76% .1 168)` | `oklch(45% .15 268)` | `oklch(78% .11 268)` |
| `--aster-accent-hi` | `accent` on hover. | `oklch(53% .1 168)` | `oklch(81% .1 168)` | `oklch(39% .155 268)` | `oklch(84% .1 268)` |
| `--aster-accent-soft` | Behind chosen and active things: the selected row, the active option. | `oklch(47% .095 168 / .085)` | `oklch(76% .1 168 / .12)` | `oklch(45% .15 268 / .09)` | `oklch(78% .11 268 / .15)` |
| `--aster-on-accent` | Text on `accent` and `accent-hi`, 4.5:1 on both. | `oklch(98% .01 160)` | `oklch(20% .03 168)` | `oklch(98% .008 250)` | `oklch(20% .05 265)` |
| `--aster-accent-sheen` | The top highlight of a primary button; `transparent` for flat. | `oklch(100% 0 0 / .18)` |  | `transparent` |  |
| `--aster-focus` | The focus ring. 3:1 on `surface`. | `oklch(from var(--aster-accent) l c h / .7)` |  | `oklch(from var(--aster-accent) l c h / .75)` |  |
| `--aster-focus-offset` | The focus ring's offset from the element. | `0px` |  | `2px` |  |
| `--aster-indicator` | Marks where to look (the tab caret), without acting. 3:1 on `surface`. | `var(--aster-accent)` |  | `oklch(62% .17 32)` | `oklch(72% .16 32)` |

### Status

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-positive` | Good news: under budget, saved. 3:1 on `surface`. | `var(--aster-accent)` |  | `oklch(50% .09 170)` | `oklch(76% .1 170)` |
| `--aster-negative` | Errors and overruns, as text. 4.5:1 on `surface`. | `oklch(53% .16 28)` | `oklch(70% .14 28)` | `oklch(50% .17 25)` | `oklch(72% .14 25)` |
| `--aster-caution` | Needs attention: behind schedule. 3:1 on `surface`. | `oklch(65% .13 75)` |  | `oklch(56% .12 68)` | `oklch(78% .11 75)` |

### Identity colours

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-identity-l` | Lightness of people's and projects' colours, whose hue comes from data. | `62%` |  | `62%` | `70%` |
| `--aster-identity-c` | Chroma of those colours. | `.1` |  | `.1` |  |

### Elevation

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-shadow` | The colour shadows are made from. | `oklch(28% .05 265)` | `oklch(6% .03 265)` | `oklch(30% .06 255)` | `oklch(5% .03 260)` |
| `--aster-highlight` | An inset top highlight (a `box-shadow`) on raised things, or `0 0 #0000`. | `inset 0 1px 0 oklch(100% 0 0 / .85)` | `inset 0 1px 0 oklch(98% .02 85 / .075)` | `0 0 #0000` |  |
| `--aster-ring` | The hairline (a `box-shadow`) that outlines raised things. | `0 0 0 .5px var(--aster-rule)` | `0 0 0 .5px oklch(0% 0 0 / .65)` | `0 0 0 1px var(--aster-rule)` |  |
| `--aster-e1` | Elevation of things at rest: cards, buttons (a `box-shadow`). | `var(--aster-ring), var(--aster-highlight), 1px 1px 2px oklch(from var(--aster-shadow) l c h / .06), 2px 3px 8px oklch(from var(--aster-shadow) l c h / .05)` | `var(--aster-ring), var(--aster-highlight), 1px 1px 2px oklch(from var(--aster-shadow) l c h / .35), 2px 3px 8px oklch(from var(--aster-shadow) l c h / .25)` | `var(--aster-ring), 0 1px 2px oklch(from var(--aster-shadow) l c h / .06)` | `var(--aster-ring), 0 1px 2px oklch(from var(--aster-shadow) l c h / .3)` |
| `--aster-e2` | Raised: a button or card on hover. | `var(--aster-ring), var(--aster-highlight), 1px 2px 4px oklch(from var(--aster-shadow) l c h / .07), 3px 8px 20px oklch(from var(--aster-shadow) l c h / .07), 6px 18px 40px oklch(from var(--aster-shadow) l c h / .06)` | `var(--aster-ring), var(--aster-highlight), 1px 2px 4px oklch(from var(--aster-shadow) l c h / .4), 3px 8px 20px oklch(from var(--aster-shadow) l c h / .35), 6px 18px 40px oklch(from var(--aster-shadow) l c h / .3)` | `var(--aster-ring), 0 3px 10px oklch(from var(--aster-shadow) l c h / .09)` | `var(--aster-ring), 0 3px 10px oklch(from var(--aster-shadow) l c h / .35)` |
| `--aster-e3` | Floating: popovers, menus, dialogs, windows. | `var(--aster-ring), var(--aster-highlight), 2px 4px 10px oklch(from var(--aster-shadow) l c h / .09), 6px 16px 36px oklch(from var(--aster-shadow) l c h / .11), 12px 32px 64px oklch(from var(--aster-shadow) l c h / .11)` | `var(--aster-ring), var(--aster-highlight), 2px 4px 10px oklch(from var(--aster-shadow) l c h / .45), 6px 16px 36px oklch(from var(--aster-shadow) l c h / .45), 12px 32px 64px oklch(from var(--aster-shadow) l c h / .4)` | `var(--aster-ring), 0 12px 32px oklch(from var(--aster-shadow) l c h / .16), 0 2px 6px oklch(from var(--aster-shadow) l c h / .07)` | `var(--aster-ring), 0 12px 32px oklch(from var(--aster-shadow) l c h / .5), 0 2px 6px oklch(from var(--aster-shadow) l c h / .3)` |
| `--aster-well` | The inset look of a field (a `box-shadow`). | `0 0 0 .5px var(--aster-rule), inset 1px 1px 2px oklch(from var(--aster-shadow) l c h / .09)` | `0 0 0 .5px oklch(0% 0 0 / .6), inset 1px 1px 2px oklch(from var(--aster-shadow) l c h / .4)` | `inset 0 0 0 1px var(--aster-rule)` |  |
| `--aster-scrim` | Behind a modal dialog. | `oklch(from var(--aster-shadow) l c h / .14)` | `oklch(0% 0 0 / .45)` | `oklch(25% .05 258 / .38)` | `oklch(8% .03 260 / .55)` |
| `--aster-press` | The inset shadow colour of a pressed primary button. | `oklch(0% 0 0 / .25)` |  | `oklch(15% .06 262 / .3)` | `oklch(0% 0 0 / .35)` |

### Shape

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-r-ctl` | Corner radius of controls. | `3px` |  | `8px` |  |
| `--aster-r-card` | Corner radius of cards and panels. | `5px` |  | `12px` |  |
| `--aster-r-pop` | Corner radius of popovers, menus and windows. | `8px` |  | `14px` |  |
| `--aster-r-dialog` | Corner radius of dialogs. | `8px` |  | `16px` |  |

### Motion

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-ease` | The easing of every transition. | `cubic-bezier(.2, .8, .2, 1)` |  | `cubic-bezier(.3, .7, .25, 1)` |  |
| `--aster-t-morph` | A dialog changing view. | `220ms` |  | `260ms` |  |
| `--aster-t-ink` | New content inking in. | `160ms` |  | `200ms` |  |
| `--aster-t-micro` | Hover and press feedback. | `120ms` |  | `140ms` |  |
| `--aster-t-caret` | The tab caret sliding. | `180ms` |  | `220ms` |  |
| `--aster-t-scheme` | Switching between light and dark. | `420ms` |  | `260ms` |  |

### Toasts

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-toast-bg` | A toast's background. | `var(--aster-text)` |  | `oklch(27% .04 258)` | `oklch(93% .012 245)` |
| `--aster-toast-text` | A toast's text, 4.5:1 on `toast-bg`. | `var(--aster-surface)` |  | `oklch(97% .008 245)` | `oklch(22% .035 258)` |
| `--aster-toast-action` | A toast's action (Undo), 4.5:1 on `toast-bg`. | `oklch(85% .1 168)` | `oklch(42% .1 168)` | `oklch(80% .1 265)` | `oklch(42% .15 268)` |
| `--aster-toast-mark` | A toast's icon. | `oklch(80% .12 168)` |  | `oklch(72% .16 32)` | `oklch(58% .17 32)` |

### The lamp

| Token | Role | Lamplight | Lamplight dark | Harbour | Harbour dark |
|---|---|---|---|---|---|
| `--aster-lamp` | Lamplight's lamp colour; a neutral white elsewhere. | `oklch(99.5% .03 88)` | `oklch(75% .06 80)` | `oklch(100% 0 0)` |  |
| `--aster-glow` | How much lamp, 0 to 1; `0` turns it off. | `1` | `.16` | `0` |  |
| `--aster-lamp-bulb` | The glow round the lamp switch's bulb; `transparent` without a lamp. | `oklch(88% .12 85 / .7)` |  | `transparent` |  |

<!-- /tokens -->
