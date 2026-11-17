import { expect, test } from "bun:test";
import { connectMockWorker, exposeMock } from "../src/worker.ts";
import { service } from "./helpers.ts";

async function workerClient() {
  const page = new EventTarget();
  const worker = new EventTarget();
  const port = (target: EventTarget, recipient: EventTarget) => ({
    addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => target.addEventListener("message", listener as EventListener),
    postMessage(message: unknown) {
      const data = structuredClone(message);
      queueMicrotask(() => recipient.dispatchEvent(new MessageEvent("message", { data })));
    },
  });
  exposeMock(await service(), port(worker, page));
  return connectMockWorker(port(page, worker));
}

test("worker transport carries cancellable reads through structured cloning", async () => {
  const client = await workerClient();
  const controller = new AbortController();
  const response = await client.transport({ method: "GET", url: "Projects(1)", signal: controller.signal });
  expect(response.status).toBe(200);
  expect(JSON.parse(response.body).name).toBe("Spring launch");
});

test("worker calls reject on abort and keep serving reads after the late reply", async () => {
  const client = await workerClient();
  client.faults.latencyMs = 20;
  const controller = new AbortController();
  const response = client.transport({ method: "GET", url: "Projects(1)", signal: controller.signal });
  controller.abort();
  await expect(response).rejects.toMatchObject({ name: "AbortError" });
  await expect(client.external({ method: "GET", url: "Projects(1)", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect((await client.transport({ method: "GET", url: "Projects(1)" })).status).toBe(200);
});
