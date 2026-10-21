import { asterComponents, compositeElement, compositeTypes as t, defineCompositeRegistry, defineCompositeRenderer, type SidebarItem } from "@getaster/elements";
import { icons } from "../workspace/icons.ts";
import { showcaseModel } from "./model.ts";
import "./views/gallery.ts";

export const showcaseAuthoring = defineCompositeRegistry({
  inputs: { active: t.signal(t.string), theme: t.signal(t.string), scheme: t.signal(t.string) },
  models: { showcase: showcaseModel },
  renderers: { categoryIcon: defineCompositeRenderer(["renderIcon"], (item: SidebarItem) => {
    switch (item.id) {
      case "tiles": return icons.folder;
      case "filters": return icons.tasks;
      case "reports": case "charts": return icons.reports;
      case "windows": case "dashboard": return icons.model;
      case "dataview": return icons.people;
      case "tabs": return icons.projects;
      default: return icons.showcase;
    }
  }) },
  components: {
    Sidebar: asterComponents.Sidebar,
    Gallery: compositeElement("aster-showcase-gallery", { theme: t.string, scheme: t.string }),
    Preview: {
      props: { file: t.string, title: t.string, theme: t.string, scheme: t.string },
      load: async () => (await import("./views/preview.ts")).createPreview,
      apply: (element, props) => { for (const [key, value] of Object.entries(props)) Reflect.set(element, key, value); },
    },
  },
});
