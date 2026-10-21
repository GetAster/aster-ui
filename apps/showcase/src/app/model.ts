import { computed } from "@preact/signals-core";
import { compositeTypes as t, defineCompositeModel } from "@getaster/elements";
import { examples } from "./catalogue.ts";

export const showcaseModel = defineCompositeModel({
  inputs: { active: t.signal(t.string), theme: t.signal(t.string), scheme: t.signal(t.string) },
  exports: {
    active: t.signal(t.string), theme: t.signal(t.string), scheme: t.signal(t.string),
    surface: t.signal(t.string), file: t.signal(t.string), title: t.signal(t.string),
    navigation: t.array(t.object({ id: t.string, label: t.string, icon: t.string, href: t.string })),
  },
  create: ({ active, theme, scheme }) => {
    const selected = computed(() => examples.find(example => example.id === active.value));
    return { values: {
      active, theme, scheme,
      surface: computed(() => selected.value ? "preview" : "gallery"),
      file: computed(() => selected.value?.file ?? ""),
      title: computed(() => selected.value?.category ?? "All examples"),
      navigation: [
        { id: "all", label: "All examples", icon: "▦", href: "#showcase" },
        ...examples.map(example => ({ id: example.id, label: example.category, icon: "◇", href: `#showcase/${example.id}` })),
      ],
    } };
  },
});
