declare module "*.ui.yaml" {
  const compiled: {
    definition: import("@getaster/elements").CompositeDefinition;
    sources: import("@getaster/elements").CompositeSources;
  };
  export default compiled;
}
