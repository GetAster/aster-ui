export default {
  worker: {
    name: "aster-ui",
    compatibilityDate: "2026-10-21",
    workersDev: false,
    previewUrls: false,
    domains: ["ui.getaster.now"],
    // Preserve explicit HTML URLs; the preparer maps declared directory indexes.
    assets: { htmlHandling: "none", notFoundHandling: "404-page" },
    observability: { enabled: false },
  },
};
