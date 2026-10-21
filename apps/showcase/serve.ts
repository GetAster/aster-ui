// The Aster demo: `bun run dev`, then open http://localhost:4173/.
import index from "./index.html";

const wasm = new URL("../../packages/mock/wasm/odata_mock.wasm", import.meta.url);
const workerEntry = new URL("./src/workspace/mock-worker.ts", import.meta.url).pathname;

/** The mock's worker, bundled on each request so edits show on reload. */
async function worker(): Promise<Response> {
  const built = await Bun.build({ entrypoints: [workerEntry], target: "browser" });
  if (!built.success) return new Response(built.logs.join("\n"), { status: 500 });
  return new Response(built.outputs[0], { headers: { "content-type": "text/javascript" } });
}
const port = Number(process.env.PORT ?? 4173);

const server = Bun.serve({
  port,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    "/odata_mock.wasm": () => new Response(Bun.file(wasm), { headers: { "content-type": "application/wasm" } }),
    "/mock-worker.js": worker,
  },
});
console.log(`Aster demo on ${server.url}`);
