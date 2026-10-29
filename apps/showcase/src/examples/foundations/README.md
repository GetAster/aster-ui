# Fields and layouts

Start with [foundations.js](foundations.js) and [foundations.html](foundations.html). The page owns the project editor, retained settings and contextual navigation. `folder-picker.js` owns the folder-selection workflow and lazy mock loading. Its styles stay in `folder-picker.css`.

Build from the repository root with `bun run site`. The example runs at
`/playground/foundations.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/foundations.spec.ts`.

## Shared control states

Open `/playground/control-states.html` (also linked from Fields and layouts) to
compare native controls and Aster components. Theme and scheme switches cover
Lamplight and Harbour in light and dark. The page's own CSS only arranges samples;
control appearance comes from the library.

Run `bun run test:e2e tests/e2e/control-states.spec.ts` for screenshots at desktop
and 375px widths in Chromium, Firefox and WebKit, plus accessibility, keyboard
focus and forced-colour interaction checks. Baselines are engine- and OS-specific;
the checked-in images are from macOS. For an intentional visual change, add
`--update-snapshots`, inspect the resulting images and diff, then rerun without
that flag. New baselines require visual review before committing. Extend this
page when adding shared primitives or states; application screenshots remain
necessary for composition and layout.
