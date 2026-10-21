// Serves a built directory as a static server would, for the browser tests:
// `bun scripts/serve-static.ts dist-local/aster` on PORT. A path the
// directory doesn't have is looked for in its parent, so the site's lib/ and
// playground/ resolve beside the demo as they do when deployed.
import { dirname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist-local/aster");
const directories = process.argv.includes("--strict") ? [root] : [root, dirname(root)];
const server = Bun.serve({
  port: Number(process.env.PORT ?? 4174),
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname));
    const name = path.endsWith("/") ? `${path}index.html` : path;
    for (const dir of directories) {
      const file = Bun.file(join(dir, name));
      if (await file.exists()) return new Response(file);
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`serving ${root} on ${server.url}`);
