import { initDocs as initSharedDocs } from "@getaster/docs/browser";

let initialized = false;
export function initDocs(): void {
  if (initialized) return;
  initialized = true;
  const syncPreviews = () => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>("main iframe")) {
      try {
        if (frame.contentDocument) frame.contentDocument.documentElement.dataset.scheme = document.documentElement.dataset.scheme;
        frame.contentWindow?.postMessage({ type: "aster-example-appearance", scheme: document.documentElement.dataset.scheme }, location.origin);
      } catch { /* Cross-origin examples own their appearance. */ }
    }
  };
  for (const frame of document.querySelectorAll("main iframe")) frame.addEventListener("load", syncPreviews);
  initSharedDocs({ onAppearanceChange: syncPreviews });
}
