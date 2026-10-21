import { compositeTypes as t, defineCompositeModel } from "../src/composition/contracts.ts";
import { defineComposite, deriveComposite } from "../src/composition/definition.ts";
import { defineElement, elementProperty } from "../src/composition/element.ts";
import { compositeElement } from "../src/composition/registry.ts";
import { html, nothing } from "lit-html";

const Badge = defineElement({ tag: "typecheck-badge", properties: {
  caption: elementProperty(t.string, () => "Ready", "Status caption"),
  active: elementProperty(t.boolean, () => false, "Active status"),
}, render: (props, element) => {
  const click = () => { element.active = true; };
  void click;
  props.caption.toUpperCase();
  // @ts-expect-error render props are read-only
  props.active = true;
  // @ts-expect-error undeclared property
  props.typo;
  return nothing;
} });
const badge = new Badge();
badge.caption = "Saving";
badge.active = true;
// @ts-expect-error direct accessors preserve inferred types
badge.active = "yes";
// @ts-expect-error undeclared property
badge.typo = true;
compositeElement(Badge);

// Compiled by the package typecheck; these expectations verify author-facing inference.
const model = defineCompositeModel({
  inputs: { title: t.string, enabled: t.optional(t.boolean) },
  exports: { count: t.number },
  create: inputs => {
    inputs.title.toUpperCase();
    const enabled: boolean | undefined = inputs.enabled;
    void enabled;
    // @ts-expect-error unknown model input
    inputs.typo;
    // @ts-expect-error title is a string, not a number
    const wrong: number = inputs.title;
    void wrong;
    return { values: { count: inputs.title.length } };
  },
});
const exports = model.read({ count: 1 });
const count: number = exports.count;
void count;
// @ts-expect-error export type is inferred from its contract
const wrong: string = exports.count;
void wrong;

const base = defineComposite({ version: 1, name: "Example", model: { type: "example" }, children: { table: { type: "Grid", props: { label: "Devices" } } }, customize: { children: { table: { props: ["label"] } } }, layout: { child: "table" } });
deriveComposite(base, { children: { table: { props: { label: "Custom devices" } } } });
// @ts-expect-error child keys are inferred from the definition
deriveComposite(base, { children: { typo: { enabled: false } } });
// @ts-expect-error existing child property names are inferred
deriveComposite(base, { children: { table: { props: { typo: true } } } });

import { defineCompositeRegistry, defineCompositeRenderer } from "../src/composition/authoring.ts";
import { Command, command, valuesPublication } from "@getaster/data";
import { signal } from "@preact/signals-core";

const typedModel = defineCompositeModel({
  inputs: { title: t.string }, exports: { title: t.signal(t.string), active: t.signal(t.boolean) },
  commands: { save: t.instance(Command) }, publications: { editor: t.publication({ dirty: t.boolean }) },
  create: ({ title }, lifetime) => ({ values: { title: signal(title), active: signal(false) },
    commands: { save: lifetime.own(command({ label: "Save", run: () => {} })) },
    publications: { editor: valuesPublication({ dirty: signal(false) }) },
  }),
});
const tools = defineCompositeRegistry({
  inputs: { caption: t.string }, models: { editor: typedModel },
  components: { Badge: compositeElement(Badge), Required: compositeElement("test-required", { caption: t.string }) },
  renderers: { card: defineCompositeRenderer(["renderCard"], (name: string) => name) },
});
const screen = { version: 1, name: "Typed", model: { type: "editor", inputs: { title: { ref: "inputs.caption" } } },
  commands: { save: { use: "model.commands.save" } }, publish: { editor: { ref: "model.publications.editor" } },
  children: { status: { type: "Badge", props: { caption: { bind: "model.title" }, active: { bind: "model.active" } } } }, layout: { child: "status" },
} as const;
tools.define(screen);
tools.define({ ...screen, children: { status: { type: "Badge" } } });
// @ts-expect-error registered component names are checked
tools.define({ ...screen, children: { status: { type: "Typo" } } });
// @ts-expect-error property names come from the component contract
tools.define({ ...screen, children: { status: { type: "Badge", props: { typo: true } } } });
// @ts-expect-error direct property values preserve the declared type
tools.define({ ...screen, children: { status: { type: "Badge", props: { active: "yes" } } } });
// @ts-expect-error a string signal cannot bind a boolean property
tools.define({ ...screen, children: { status: { type: "Badge", props: { active: { bind: "model.title" } } } } });
// @ts-expect-error public reference paths are checked
tools.define({ ...screen, children: { status: { type: "Badge", props: { active: { bind: "model.typo" } } } } });
// @ts-expect-error ref passes the signal object rather than its boolean value
tools.define({ ...screen, children: { status: { type: "Badge", props: { active: { ref: "model.active" } } } } });
// @ts-expect-error wrong model input type
tools.define({ ...screen, model: { type: "editor", inputs: { title: false } } });
// @ts-expect-error missing required component property
tools.define({ ...screen, children: { status: { type: "Required" } } });
// @ts-expect-error command references must resolve to a Command
tools.define({ ...screen, commands: { save: { use: "model.title" } } });
// @ts-expect-error publication references must resolve to a Publication
tools.define({ ...screen, publish: { editor: { ref: "model.commands.save" } } });
// @ts-expect-error a renderer is not registered for caption and has the wrong value type
tools.define({ ...screen, children: { status: { type: "Badge", props: { caption: { renderer: "card" } } } } });

// @ts-expect-error layout child references are checked
tools.define({ ...screen, layout: { child: "missing" } });
// @ts-expect-error an outlet needs a boolean binding
tools.define({ ...screen, layout: { type: "outlet", active: { bind: "model.title" }, content: { child: "status" } } });
tools.placement(screen, place => {
  place("status");
  // @ts-expect-error placement uses the definition's child names
  place("missing");
  return html`<section>${place("status")}</section>`;
});

import { Composite } from "../src/composition/composite.ts";
new Composite(screen, tools.registry, { inputs: { caption: "Devices" } });
// @ts-expect-error catalog host inputs are required
new Composite(screen, tools.registry);
// @ts-expect-error required host inputs cannot be omitted from options
new Composite(screen, tools.registry, {});
// @ts-expect-error host input values preserve their declared types
new Composite(screen, tools.registry, { inputs: { caption: false } });
// @ts-expect-error undeclared host inputs are rejected
new Composite(screen, tools.registry, { inputs: { caption: "Devices", extra: true } });
// @ts-expect-error catalog registries expose lookup, not registration
tools.registry.model("extra", typedModel);
// @ts-expect-error a catalog registry cannot be resealed with a different host contract
tools.registry.seal({});

const closed = t.object({ allowed: t.string });
const wider = t.object({ allowed: t.string, extra: t.string });
const exactModel = defineCompositeModel({ inputs: {}, exports: {
  exact: closed, wide: wider, exactList: t.array(closed), wideList: t.array(wider),
  wideSignal: t.signal(wider), exactSignal: t.signal(closed),
  nestedWide: t.object({ child: wider }),
}, create: () => ({ values: {
  exact: { allowed: "yes" }, wide: { allowed: "yes", extra: "no" },
  exactList: [], wideList: [], wideSignal: signal({ allowed: "yes", extra: "no" }),
  exactSignal: signal({ allowed: "yes" }), nestedWide: { child: { allowed: "yes", extra: "no" } },
} }) });
const ExactElement = defineElement({ tag: "typecheck-exact", properties: {
  config: elementProperty(closed, () => ({ allowed: "yes" }), "Strict config"),
}, render: () => nothing });
const exactTools = defineCompositeRegistry({ models: { exact: exactModel }, components: {
  Closed: compositeElement("test-closed", { config: closed, items: t.array(closed), nested: t.optional(t.object({ child: closed })), configSignal: t.optional(t.signal(closed)) }),
  Custom: compositeElement(ExactElement),
} });
const exactScreen = { version: 1, name: "Exact", model: { type: "exact" }, children: { view: { type: "Closed", props: { config: { ref: "model.exact" }, items: { ref: "model.exactList" } } } }, layout: { child: "view" } } as const;
exactTools.define(exactScreen);
// @ts-expect-error strict object targets reject known extra source keys
exactTools.define({ ...exactScreen, children: { view: { type: "Closed", props: { config: { ref: "model.wide" }, items: [] } } } });
// @ts-expect-error arrays preserve strict item contracts
exactTools.define({ ...exactScreen, children: { view: { type: "Closed", props: { config: { ref: "model.exact" }, items: { ref: "model.wideList" } } } } });
// @ts-expect-error signal binds preserve strict object contracts
exactTools.define({ ...exactScreen, children: { view: { type: "Closed", props: { config: { bind: "model.wideSignal" }, items: [] } } } });
// @ts-expect-error nested references preserve strict child contracts
exactTools.define({ ...exactScreen, children: { view: { type: "Closed", props: { config: { ref: "model.exact" }, items: [], nested: { ref: "model.nestedWide" } } } } });
// @ts-expect-error refs to signal objects preserve their inner object contract
exactTools.define({ ...exactScreen, children: { view: { type: "Closed", props: { config: { ref: "model.exact" }, items: [], configSignal: { ref: "model.wideSignal" } } } } });
// @ts-expect-error declared elements keep the strict contract from their property declaration
exactTools.define({ ...exactScreen, children: { view: { type: "Custom", props: { config: { ref: "model.wide" } } } } });
exactTools.placement(exactScreen, place => html`<section>${place()}</section>`);
