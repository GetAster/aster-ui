import { fileURLToPath } from "node:url";
import index from "./index.html";

// The mock package ships its engine at wasm/odata_mock.wasm. A page asks for
// the documented root-relative route; this server reads the installed file.
const wasm = Bun.file(fileURLToPath(import.meta.resolve("@getaster/mock/wasm/odata_mock.wasm")));
const port = Number(process.env.PORT ?? 4200);

const server = Bun.serve({
  port,
  development: true,
  routes: {
    "/": index,
    "/odata_mock.wasm": () => new Response(wasm, { headers: { "content-type": "application/wasm" } }),
  },
});
console.log(`Aster UI template on ${server.url}`);
