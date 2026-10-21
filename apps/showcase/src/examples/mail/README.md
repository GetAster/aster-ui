# Mail workspace

Start with [mail.js](mail.js) and [mail.html](mail.html). The host supplies authentication recovery, renderers and application event wiring. `mail.ui.yaml` composes the screen; `mail-model.js` owns message queries, keyed panels, drafts and commands. `mail-mock.js` contains service metadata and seed messages. `mail.css` owns presentation.

Build from the repository root with `bun run site`. The example runs at
`/playground/mail.html`; its public filenames are declared in
`apps/showcase/build/assets.ts`. Package imports resolve through the static
site's import map. YAML, where present, is compiled to JSON during the build.

The workflow checks are in `tests/e2e/authentication.spec.ts`.
