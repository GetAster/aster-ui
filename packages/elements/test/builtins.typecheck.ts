import { asterComponents } from "../src/composition/builtins.ts";
import { defineCompositeRegistry, defineCompositeRenderer } from "../src/composition/authoring.ts";
import { defineCompositeModel } from "../src/composition/contracts.ts";

const authoring = defineCompositeRegistry({
  renderers: { date: defineCompositeRenderer(["formatters"], (value: unknown) => String(value)) },
  models: { empty: defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) }) },
  components: { Form: asterComponents.Form, Grid: asterComponents.Grid, Tabs: asterComponents.Tabs, Sidebar: asterComponents.Sidebar, ProgressStatus: asterComponents.ProgressStatus },
});
const base = { version: 1, name: "BuiltinTypes", model: { type: "empty" }, layout: { child: "view" } } as const;
authoring.define({ ...base, children: { view: { type: "Form", props: { sections: [{ title: "Details", items: ["name"] }] } } } });
authoring.define({ ...base, children: { view: { type: "Sidebar", props: { items: [{ id: "devices", label: "Devices" }] } } } });
authoring.define({ ...base, children: { view: { type: "Grid", props: { selectable: true } } } });
authoring.define({ ...base, children: { view: { type: "ProgressStatus", props: { busy: true, progressPolicy: { delayMs: 300 }, completeText: "Updated" } } } });
authoring.define({ ...base, children: { view: { type: "Grid", props: { progressPolicy: { minVisibleMs: 500 } } } } });
authoring.define({ ...base, children: { view: { type: "Grid", props: { view: { columns: [{ field: "date", sortField: "receivedAt" }], sort: [], filters: {}, frozen: 0 } } } } });
authoring.define({ ...base, children: { view: { type: "Grid", props: { formatters: { date: { renderer: "date" } } } } } });
// @ts-expect-error Formatters must be functions.
authoring.define({ ...base, children: { view: { type: "Grid", props: { formatters: { date: "formatted" } } } } });
// @ts-expect-error Timing values are numeric milliseconds.
authoring.define({ ...base, children: { view: { type: "ProgressStatus", props: { progressPolicy: { delayMs: "slow" } } } } });
// @ts-expect-error Built-in property types are retained through the shared map.
authoring.define({ ...base, children: { view: { type: "Grid", props: { selectable: "yes" } } } });
// @ts-expect-error Tabs activation is a closed union.
authoring.define({ ...base, children: { view: { type: "Tabs", props: { activation: "sometimes" } } } });
// @ts-expect-error Read-only state is not a configurable Grid property.
authoring.define({ ...base, children: { view: { type: "Grid", props: { activeKey: "[1]" } } } });
