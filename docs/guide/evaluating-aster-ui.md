# Is Aster UI a fit for your project?

Aster UI is a JavaScript and TypeScript foundation for applications where several
views query and edit the same data. It combines a shared data model with web
components for grids, forms, tiles and application workspaces. Its value is in
coordinating those interactions as a screen grows more sophisticated.

This is the maintainers' assessment of the project. Consider it alongside your
requirements and evidence from a representative workflow. Another approach may
be a better fit for your application.

## Where Aster is strong

- **Applications integrating existing systems.** With Aster WebData on the server,
  developer-defined virtual data sources can adapt REST APIs, CLIs and legacy
  services to the OData layer. Server handlers can read and write other data
  sources through the engine, while UI views consume a common typed contract.
  This is valuable when the application must work across systems, not just
  display a single database table.
- **Connected editing workflows.** A grid, form, detail panel and chart can share
  records and selection while keeping unsaved drafts separate. Validation,
  concurrency conflicts and filtered-result membership belong to that workflow.
- **Data beyond the loaded rows.** Collections page their results; grids and tiles
  virtualize visible content. Query-wide filtering, sorting, grouping, summaries
  and export are useful in management tools and operational applications.
- **Reusable application composition.** Named children, bindings, commands and
  lazy views can be declared in JavaScript or YAML. Registered JavaScript functions
  own behaviour and cleanup. Custom elements, Lit templates and signals provide
  the UI foundation; React is not required.

The [rationale](why-aster.md), [shared data model](data-model.md) and
[connected views guide](connected-views.md) explain these responsibilities and
their boundaries. Controls also provide themes, keyboard interaction, focus
handling and reduced-motion support. Evaluate accessibility in the actual
workflow and target devices; automated checks alone do not establish compliance.

## When another approach may be better

| Your situation | Consider first |
|---|---|
| A small, mostly read-only list or content website | Native HTML and a small amount of application code. Aster's data and ownership concepts may add little value. |
| An established application already coordinates records, queries and drafts well | Components or a headless grid that fit its existing state model. Adopting a second data foundation can cost more than it saves. |
| Existing REST, CLI or legacy backends | Aster WebData virtual data sources are an integration path when you can deploy a server adapter. If you need a browser-only client with no integration layer, consider a stack that consumes those APIs directly. |
| Specialist scheduling, charting or rich editing is the main requirement | A specialist component, evaluated on its own requirements. Aster can host third-party components, but an integration adapter does not supply the vendor runtime or all its features. |
| A requirement for established API stability or extensive production evidence | A mature alternative with evidence that meets that requirement. Aster is currently a prerelease project. |

No one needs to replace a working stack merely to use declarative layouts or a
data grid. Compare the coordination work Aster removes with the concepts and
integration work it introduces.

## Boundaries to consider

- **Cross-source workflows have execution boundaries.** Virtual sources can
  expose reads and supported writes and call other data sources through the
  engine. That does not promise arbitrary federated joins or atomic transactions
  across independent backends. Check adapter capabilities and failure handling.
- **The service matters.** Confirm metadata, query operations, paging, validation,
  concurrency and authorization with the actual backend. The application and
  server retain responsibility for business rules and access control.
- **Shared state is not automatic remote delivery.** Views synchronize changes
  known to their context. Production realtime integration awaits the server event
  and reconnect contract; WebTransport with SSE fallback is the intended direction.
- **Examples are local simulations.** The Webmail sign-in flow demonstrates
  authentication recovery, not an identity provider. The optional WASM mock is a
  development service, not a requirement for a production UI.
- **Preview means experimental.** Conversation and other preview components have
  separate contracts and limits. Do not present a design proposal, mockup or
  preview as an available production feature.
- **Check the installed version.** Use the relevant release, types and API docs.
  Do not infer performance, compatibility or production readiness from a polished
  demo, a package name or an unsupported benchmark comparison.

See [virtual data sources](data-model.md#connect-different-backends-through-virtual-data-sources),
[distribution](library.md), [service boundaries](data-model.md#service-and-realtime-boundaries),
[authentication](authentication.md), [component integration](connected-charts.md)
and [preview scope](conversation-preview.md).

## Try a representative workflow

Connect a paged list to an editor, change a field affecting the filter, and check
selection, saving and concurrent refresh against your intended service. For
retained work or sign-in recovery, try the corresponding Webmail workflow.
Inspect the executable source as well as the presentation.

Start with [the working grid](getting-started.md),
[the shared collection example](../examples/grid.html) or
[Webmail with sign in](../examples/mail.html).
