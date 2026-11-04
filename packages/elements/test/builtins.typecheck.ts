import { asterComponents } from "../src/composition/builtins.ts";
import { defineCompositeRegistry, defineCompositeRenderer } from "../src/composition/authoring.ts";
import { defineCompositeModel } from "../src/composition/contracts.ts";
import type { FieldPolicy, GridPolicy } from "../src/grid/policy.ts";

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
authoring.define({ ...base, children: { view: { type: "Grid", props: { chrome: { toolbar: false, header: false, filterRow: "auto", headerMenu: false, pagingBar: false } as const, toolbar: { count: false, sort: false, filters: false, advanced: false, columns: false, views: false }, showHeader: false, showToolbar: false, showFilterRow: false, showHeaderMenu: false, showPagingBar: false } } } });
// @ts-expect-error The filter row is automatic, forced open or removed.
authoring.define({ ...base, children: { view: { type: "Grid", props: { chrome: { filterRow: "sometimes" } } } } });
authoring.define({ ...base, children: { view: { type: "Grid", props: { policy: { sortable: false, filterable: ["name"], selectable: false, fields: { name: { editable: false, sortable: ["name"] } } } } } } });
authoring.define({ ...base, children: { view: { type: "Grid", props: { sortable: ["name"], filterable: true, editable: ["name"] } } } });
// @ts-expect-error Policy capability entries are booleans or field allowlists, not a bare field name.
authoring.define({ ...base, children: { view: { type: "Grid", props: { policy: { sortable: "name" } } } } });
const acceptedPolicy: GridPolicy = {
  sortable: false, filterable: ["name"], groupable: ["name"], resizable: true, movable: false,
  hideable: ["name"], freezable: true, fields: { name: { editable: false, groupable: true, resizable: false, movable: true, hideable: false, freezable: true } },
};
const acceptedFieldPolicy: FieldPolicy = { sortable: ["name"], filterable: true, groupable: false, resizable: ["name"], movable: true, hideable: false, freezable: true };
// @ts-expect-error Capability entries are booleans, field allowlists or predicates, not a bare field name.
const refusedPolicy: GridPolicy = { groupable: "name" };
// @ts-expect-error Field policy has no per-field presentation: capabilities only.
const refusedFieldPolicy: FieldPolicy = { width: 120 };
void [acceptedPolicy, acceptedFieldPolicy, refusedPolicy, refusedFieldPolicy];
authoring.define({ ...base, children: { view: { type: "Grid", props: {
  features: [{ kind: "sort", multi: false }, { kind: "edit", mode: "cell" }, { kind: "select", appearance: "cell", column: true }, { kind: "page" }],
  multiSort: false, editMode: "cell", selectionAppearance: "cell", selectionColumn: true,
  groupable: ["name"], resizable: false, movable: true, hideable: ["name"], freezable: true,
} } } });
// @ts-expect-error Feature kinds are a closed union.
authoring.define({ ...base, children: { view: { type: "Grid", props: { features: [{ kind: "resize" }] } } } });
// @ts-expect-error Edit mode is a closed union.
authoring.define({ ...base, children: { view: { type: "Grid", props: { features: [{ kind: "edit", mode: "form" }] } } } });
// @ts-expect-error Selection appearance is a closed union.
authoring.define({ ...base, children: { view: { type: "Grid", props: { features: [{ kind: "select", appearance: "checkbox" }] } } } });
// @ts-expect-error Features are a list of descriptors.
authoring.define({ ...base, children: { view: { type: "Grid", props: { features: { kind: "page" } } } } });
// @ts-expect-error Multi-sort is a boolean.
authoring.define({ ...base, children: { view: { type: "Grid", props: { multiSort: "no" } } } });
// @ts-expect-error Edit mode is a closed union.
authoring.define({ ...base, children: { view: { type: "Grid", props: { editMode: "form" } } } });
// @ts-expect-error Selection appearance is a closed union.
authoring.define({ ...base, children: { view: { type: "Grid", props: { selectionAppearance: "checkbox" } } } });
// @ts-expect-error The selection column is a boolean.
authoring.define({ ...base, children: { view: { type: "Grid", props: { selectionColumn: "yes" } } } });
authoring.define({ ...base, children: { view: { type: "Grid", props: { autoFetch: false, loadingMessage: "Fetching rows…" } } } });
authoring.define({ ...base, children: { view: { type: "Grid", props: { pageSize: 50, keepPages: 4, exactCount: true } } } });
authoring.define({ ...base, children: { view: { type: "Grid", props: {
  toolbar: { expandAll: false },
  tree: { parentField: "parentId", draggable: true, reparent: false, dropOnLeaves: false, autoOpen: 2, showOpener: false, cascadeSelection: true, pageSize: 50, matchLimit: 100, openLimit: 20 },
} } } });
// @ts-expect-error Tree auto-open depth is a number.
authoring.define({ ...base, children: { view: { type: "Grid", props: { tree: { parentField: "parentId", autoOpen: "deep" } } } } });
// @ts-expect-error Tree cascade selection is a boolean.
authoring.define({ ...base, children: { view: { type: "Grid", props: { tree: { parentField: "parentId", cascadeSelection: "yes" } } } } });
// @ts-expect-error Tree level page size is a number.
authoring.define({ ...base, children: { view: { type: "Grid", props: { tree: { parentField: "parentId", pageSize: "many" } } } } });
// @ts-expect-error autoFetch is a boolean.
authoring.define({ ...base, children: { view: { type: "Grid", props: { autoFetch: "no" } } } });
// @ts-expect-error The page size is a number.
authoring.define({ ...base, children: { view: { type: "Grid", props: { pageSize: "ten" } } } });
// @ts-expect-error The retained page count is a positive integer.
authoring.define({ ...base, children: { view: { type: "Grid", props: { keepPages: "many" } } } });
// @ts-expect-error The exact-count request is a boolean.
authoring.define({ ...base, children: { view: { type: "Grid", props: { exactCount: "yes" } } } });
// @ts-expect-error The loading message is text.
authoring.define({ ...base, children: { view: { type: "Grid", props: { loadingMessage: 42 } } } });
// @ts-expect-error The error retry is a JavaScript function, like renderers.
authoring.define({ ...base, children: { view: { type: "Grid", props: { error: () => undefined } } } });
authoring.define({ ...base, children: { view: { type: "Grid", props: { filterOperators: { hours: ["gt", "ge"] } } } } });
// @ts-expect-error Column menu items are functions.
authoring.define({ ...base, children: { view: { type: "Grid", props: { columnMenu: true } } } });
// @ts-expect-error Column menu functions are JavaScript-only, like rowMenu.
authoring.define({ ...base, children: { view: { type: "Grid", props: { columnMenu: (field: string) => [{ label: field, run: () => {} }] } } } });
// @ts-expect-error Operator allowlists hold operator names.
authoring.define({ ...base, children: { view: { type: "Grid", props: { filterOperators: { hours: "gt" } } } } });
// @ts-expect-error Predicates are a JavaScript property value, not composition data.
authoring.define({ ...base, children: { view: { type: "Grid", props: { sortable: (field: string) => field === "name" } } } });
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
