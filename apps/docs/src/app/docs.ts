import { initDocs } from "./main.ts";
import { enhanceArticle } from "@getaster/docs/browser";
import { initExplorer } from "../features/examples/explorer.ts";

initDocs();
enhanceArticle();
initExplorer();
