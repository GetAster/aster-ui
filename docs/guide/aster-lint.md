# Check an application with aster-lint

Aster UI provides elements for the controls an application needs: buttons,
fields, checkboxes, selects, grids, dialogs, tabs and navigation. They share
binding, validation, keyboard behaviour, states and themes. A hand-made control
works on the day it is written but falls out of step: it misses a state, a theme
or an accessibility rule the element already handles.

`aster-lint` checks an application's templates, HTML and CSS for those
shortcuts. Each finding names the Aster element to use instead and its entry in
the [reference](../reference/). Where no element fits, a comment silences the
finding and records why, so the exceptions stay visible and can be reported as
gaps.

## Run it

`aster-lint` ships with `@getaster/elements`. Point it at the application's
source and page files:

```sh
bunx aster-lint src index.html
bunx aster-lint --theme src/brand-theme.css src   # a theme file may set tokens
bunx aster-lint --allowances src                  # also list every silence
```

It reads `.ts`, `.tsx`, `.js`, `.mjs`, `.html` and `.css` files, skipping
`node_modules`, `dist`, `build`, hidden directories, type declarations and
`*.test.*` or `*.spec.*` files. It exits with 1 when it finds a problem, so it
can run in a pre-commit hook or CI:

```json
{ "scripts": { "lint": "aster-lint src index.html" } }
```

## What it checks

In lit `html` templates, strings assigned to `innerHTML`, `createElement`
calls and HTML files:

| Rule | Finds | Use instead |
|---|---|---|
| `native-button` | `<button>`, button-type inputs | `aster-button`, `aster-command-bar`, `aster-menu` |
| `native-checkbox` | `<input type="checkbox">` | `aster-check`, `aster-switch` |
| `native-input` | Text, number and date inputs | `aster-field`, `aster-number-field`, `aster-date`, `aster-picker` |
| `native-textarea` | `<textarea>` | `aster-field` |
| `native-select` | `<select>` | `aster-select`, `aster-choice` |
| `native-table` | `<table>` | `aster-grid` |
| `native-dialog` | `<dialog>` | `aster-dialog` |
| `native-details` | `<details>` | `aster-disclosure` inside text, `aster-section`, `aster-accordion` |
| `native-progress` | `<progress>` | `aster-progress-status` |
| `native-form` | `<form>` | `aster-form` |
| `role-…` | Hand-made ARIA widgets: tabs, menus, listboxes, comboboxes, trees, grids, dialogs, switches and toolbars | The matching element |

Radio inputs, ranges, file inputs, links, headings and layout elements have no
Aster replacement and aren't flagged. A panel a host gives `role="tabpanel"`
for `aster-tabs` is expected and isn't flagged either.

In CSS files, `<style>` blocks, `style` attributes and lit `css` templates:

| Rule | Finds |
|---|---|
| `css-restyle` | Selectors that reach into Aster's own markup: an `.aster-*` class, a descendant of an Aster element that isn't the application's own content, or a pseudo-element on one. Also any property on an Aster element other than placing it: size, position, margin, and grid or flex placement. Its custom properties, such as `--split-handle`, may be set. |
| `css-colour` | Fixed colours: hex values, colour functions and colour names. A colour worked out from a token, such as `oklch(from var(--aster-accent) l c h / .2)` or `color-mix()` with tokens, is fine. |
| `css-font` | Font families and weights given directly instead of `--aster-font-ui`, `--aster-font-figure` and the `--aster-weight` tokens. `@font-face` rules are exempt. |
| `css-token` | Setting an `--aster-*` token outside a theme file passed with `--theme`. Component variables ([[constant:COMPONENT_VARS]]), such as `--aster-window-header-height`, may be set on one placement. |

Layout CSS that arranges the application's own regions is not checked. Styling
the application's own markup inside an Aster element, such as a renderer's
`.status` class in a grid cell, is the application's content and is allowed.

## Silence a finding

When no Aster element fits, add a comment on the finding's line or the line
above it, naming the rule and the reason:

```html
<!-- aster-allow native-select: a native list of 400 time zones -->
<select name="zone">…</select>
```

```ts
// aster-allow native-button, native-input: the sign-in form posts natively
html`<form method="post"><input name="user"><button>Sign in</button></form>`;
```

```css
/* aster-allow css-colour: the brand mark's fixed colour */
.logo { color: #0a5; }
```

A silence without a reason, with a rule name that doesn't exist, or with
nothing on its line or the next to silence is itself a problem. That keeps
silences meaningful as the code changes. `--allowances` lists them all with
their reasons. A silence that marks a missing element or property is worth
reporting, so Aster can fill the gap.
