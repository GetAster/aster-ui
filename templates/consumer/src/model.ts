import { Collection, DataContext, Selection } from "@getaster/data";
import { asterComponents, compositeTypes as t, defineCompositeModel, defineCompositeRegistry } from "@getaster/elements";

/** The screen's shared state: one collection and its selection. */
export const projectWorkspace = defineCompositeModel({
  inputs: { ctx: t.instance(DataContext) },
  exports: { collection: t.instance(Collection), selection: t.instance(Selection) },
  create({ ctx }, lifetime) {
    const collection = ctx.collection({ set: "Projects", orderBy: [{ field: "name" }] }, { pageSize: 20 });
    lifetime.defer(() => ctx.release(collection));
    const selection = new Selection(ctx.store, collection);
    return { values: { collection, selection } };
  },
});

/** Names the YAML definition may use; everything else fails validation. */
export const authoring = defineCompositeRegistry({
  inputs: { ctx: t.instance(DataContext) },
  models: { projects: projectWorkspace },
  components: asterComponents,
});
