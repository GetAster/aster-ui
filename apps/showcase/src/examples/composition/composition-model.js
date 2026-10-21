import { Command, Collection, DataContext, EditModel, Selection, command, selectionOptionsError, selectionPublication, valuesPublication } from "@getaster/data";
import { compositeTypes as t, defineCompositeModel } from "@getaster/elements";
import { computed, signal } from "@preact/signals-core";

// Ordinary application functions, called by this instance's exported commands.
async function saveDevice(editor) {
  const saved = await editor.save();
  if (!saved) throw new Error("Review the field errors before saving again.");
  return saved;
}

export function createDeviceWorkspace({ ctx, selection: selectionPolicy }, lifetime) {
  const query = signal("");
  const collection = ctx.collection(computed(() => {
    const name = query.value.trim();
    return { set: "Devices", orderBy: [{ field: "name" }], ...(name ? { filter: { op: "contains", field: "name", value: name } } : {}) };
  }), { pageSize: 24, keepPages: 3 });
  lifetime.defer(() => ctx.release(collection));
  const selection = new Selection(ctx.store, collection, selectionPolicy);
  const presentation = signal("table");
  const editor = signal();
  const detailsOpen = computed(() => editor.value !== undefined);
  const dirty = computed(() => editor.value?.dirty.value ?? false);
  const busy = computed(() => editor.value?.busy.value ?? false);
  const message = signal("Select a device, open its editor, then try both presentations.");
  const closeEditor = () => { const previous = editor.value; editor.value = undefined; previous?.dispose(); };
  lifetime.defer(closeEditor);
  const ownCommand = options => lifetime.own(command(options));
  const commands = {
    table: ownCommand({ label: "Table", run: () => { presentation.value = "table"; } }),
    tiles: ownCommand({ label: "Tiles", run: () => { presentation.value = "tiles"; } }),
    clear: ownCommand({ label: "Clear selection", enabled: () => selection.any.value, run: () => selection.clear() }),
    edit: ownCommand({ label: "Edit selected", enabled: () => selection.any.value && !detailsOpen.value,
      reason: () => detailsOpen.value ? "Save or discard the current draft first." : "Select a device to edit.",
      run: () => { editor.value = new EditModel(ctx, "Devices", selection.key.value); message.value = "One draft is shared across both presentations. Save also works with Ctrl/⌘ S."; } }),
    save: ownCommand({ label: "Save device", enabled: () => dirty.value && !busy.value,
      run: async signal => { const edit = editor.value; await saveDevice(edit); signal.throwIfAborted(); message.value = "Saved. The shared store updated both views."; closeEditor(); } }),
    discard: ownCommand({ label: "Discard draft", enabled: () => detailsOpen.value && !busy.value,
      run: () => { closeEditor(); message.value = "Draft discarded. The stored record is unchanged."; } }),
  };
  return {
    values: { collection, selection, presentation, editor, detailsOpen, dirty, busy, query, message },
    publications: { selection: selectionPublication(selection), editor: valuesPublication({ dirty, busy }) },
    commands,
  };
}

export const deviceWorkspaceType = defineCompositeModel({
  inputs: {
    ctx: t.instance(DataContext),
    selection: t.refine(
      t.object({ multiple: t.boolean, ordered: t.optional(t.boolean), maxOrdered: t.optional(t.positiveInteger), fallback: t.optional(t.boolean) }),
      "selection policy (ordered requires multiple; maxOrdered requires ordered)",
      value => selectionOptionsError(value) === undefined,
      { allOf: [
        { if: { properties: { ordered: { const: true } }, required: ["ordered"] }, then: { properties: { multiple: { const: true } }, required: ["multiple"] } },
        { if: { required: ["maxOrdered"] }, then: { properties: { ordered: { const: true } }, required: ["ordered"] } },
      ] },
    ),
  },
  exports: {
    collection: t.instance(Collection), selection: t.instance(Selection),
    presentation: t.signal(t.string), editor: t.signal(t.optional(t.instance(EditModel))),
    detailsOpen: t.signal(t.boolean), dirty: t.signal(t.boolean), busy: t.signal(t.boolean), query: t.signal(t.string), message: t.signal(t.string),
  },
  commands: Object.fromEntries(["table", "tiles", "clear", "edit", "save", "discard"].map(name => [name, t.instance(Command)])),
  publications: {
    selection: t.publication({ any: t.boolean, many: t.boolean, count: t.number }),
    editor: t.publication({ dirty: t.boolean, busy: t.boolean }),
  },
  create: createDeviceWorkspace,
});
