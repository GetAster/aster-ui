import { initDocs } from "./main.ts";
import { enhanceArticle } from "@getaster/docs/browser";
import { initExplorer } from "../features/examples/explorer.ts";

initDocs();
enhanceArticle();
initExplorer();

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy-prompt]")) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copyPrompt!);
      button.textContent = "Copied";
      const status = document.getElementById("doc-status");
      if (status) status.textContent = "Prompt copied to clipboard";
      setTimeout(() => { button.textContent = "Copy"; }, 1800);
    } catch {
      const selection = getSelection()!;
      selection.selectAllChildren(button.previousElementSibling!);
    }
  });
}
