import { expect, test } from "bun:test";
import { Authentication, AuthenticationError, fetchTransport, type ODataResponse, type Transport } from "../src/index.ts";

const ok: ODataResponse = { status: 200, headers: {}, body: "ok" };
const denied: ODataResponse = { status: 401, headers: { "www-authenticate": 'Bearer error="invalid_token"' }, body: "" };
const request = { method: "GET", url: "Messages" } as const;
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await Bun.sleep(2); }
  throw new Error("authentication test timed out");
}

test("concurrent challenges and newly queued work share recovery and fresh credentials", async () => {
  let token = "expired", logins = 0, calls = 0;
  const login = deferred();
  const auth = new Authentication({ identity: () => "tenant/alice", credentials: () => ({ authorization: token }), recover: async () => { logins++; await login.promise; token = "fresh"; } });
  const transport = auth.wrap(async req => { calls++; return req.headers?.authorization === "fresh" ? ok : denied; });
  const first = transport(request), second = transport(request);
  await until(() => logins === 1);
  const third = transport({ ...request, method: "POST", body: "draft" });
  await Bun.sleep(5); expect(calls).toBe(2); expect(auth.recovering.value).toBe(true);
  login.resolve(); expect(await Promise.all([first, second, third])).toEqual([ok, ok, ok]);
  expect(logins).toBe(1); expect(calls).toBe(5); expect(auth.recovering.value).toBe(false); auth.dispose();
});

test("late old-credential 401 does not start another login", async () => {
  const late = deferred<ODataResponse>(); let calls = 0, logins = 0;
  const auth = new Authentication({ identity: () => "alice", recover: async () => { logins++; } });
  const wrapped = auth.wrap(async () => { calls++; if (calls === 1) return late.promise; return calls === 2 ? denied : ok; });
  const slow = wrapped(request);
  await until(() => calls === 1);
  expect(await wrapped(request)).toBe(ok);
  late.resolve(denied); expect(await slow).toBe(ok); expect(logins).toBe(1); auth.dispose();
});

test("403 passes through and custom classification is explicit", async () => {
  const forbidden = { ...denied, status: 403 }; let logins = 0;
  const auth = new Authentication({ identity: () => "alice", recover: async () => { logins++; } });
  expect(await auth.wrap(async () => forbidden)(request)).toBe(forbidden); expect(logins).toBe(0); auth.dispose();
  const custom = new Authentication({ identity: () => "alice", challenge: ({ response }) => response.status === 403 && response.body === "session-expired", recover: async () => { logins++; } });
  let calls = 0;
  expect(await custom.wrap(async () => ++calls === 1 ? { ...forbidden, body: "session-expired" } : ok)(request)).toBe(ok);
  expect(logins).toBe(1); custom.dispose();
});

test("writes require explicit replay and retain idempotency/body/ETag on retry", async () => {
  let logins = 0;
  const auth = new Authentication({ identity: () => "alice", recover: async () => { logins++; } });
  await expect(auth.wrap(async () => denied)({ ...request, method: "POST" })).rejects.toMatchObject({ reason: "replay-blocked" });
  expect(logins).toBe(0); auth.dispose();
  const approved = new Authentication({ identity: () => "alice", replay: () => true, recover: async () => {} });
  const seen: unknown[] = [];
  const wrapped = approved.wrap(async req => { seen.push(req); return seen.length === 1 ? denied : ok; });
  const headers = { "if-match": 'W/"4"', "idempotency-key": "send-42" };
  const pending = wrapped({ ...request, method: "POST", body: "hello", headers });
  headers["if-match"] = "mutated";
  expect(await pending).toBe(ok); expect(seen[0]).toEqual(seen[1]); expect(seen[0]).toMatchObject({ body: "hello", headers: { "if-match": 'W/"4"', "idempotency-key": "send-42" } }); approved.dispose();
});

test("failed recovery settles every waiter and a later action can try again", async () => {
  const login = deferred(); let count = 0;
  const auth = new Authentication({ identity: () => "alice", recover: async () => { count++; await login.promise; } });
  const wrapped = auth.wrap(async () => denied);
  const results = Promise.allSettled([wrapped(request), wrapped(request)]);
  await until(() => count === 1); login.reject(new Error("SDK failed"));
  for (const result of await results) { expect(result.status).toBe("rejected"); if (result.status === "rejected") expect(result.reason).toMatchObject({ reason: "failed" }); }
  expect(auth.recovering.value).toBe(false); auth.dispose();
});

test("one cancelled request leaves other waiters alive; last cancellation aborts recovery", async () => {
  const login = deferred(); let recoverySignal: AbortSignal | undefined;
  const auth = new Authentication({ identity: () => "alice", recover: async ({ signal }) => { recoverySignal = signal; await login.promise; } });
  let valid = false;
  const wrapped = auth.wrap(async () => valid ? ok : denied);
  const first = new AbortController(), second = new AbortController();
  const a = wrapped({ ...request, signal: first.signal }).catch(error => error);
  const b = wrapped({ ...request, signal: second.signal }).catch(error => error);
  await until(() => !!recoverySignal); first.abort();
  expect((await a).name).toBe("AbortError"); expect(recoverySignal!.aborted).toBe(false);
  second.abort(); expect((await b).name).toBe("AbortError"); expect(recoverySignal!.aborted).toBe(true);
  valid = true; login.resolve(); await Bun.sleep(5); expect(auth.recovering.value).toBe(false); expect(await wrapped(request)).toBe(ok); auth.dispose();
});

test("timeout and disposal settle requests even if SDK ignores abort", async () => {
  for (const reason of ["timeout", "disposed"] as const) {
    const never = deferred();
    const auth = new Authentication({ identity: () => "alice", timeoutMs: 20, recover: () => never.promise });
    const result = auth.wrap(async () => denied)(request).catch(error => error);
    await until(() => auth.recovering.value);
    if (reason === "disposed") auth.dispose();
    expect(await result).toMatchObject({ reason });
    never.resolve(); await Bun.sleep(5); expect(auth.recovering.value).toBe(false); auth.dispose();
  }
});

test("account or tenant changes prevent replay; repeated challenges are bounded", async () => {
  let identity = "tenant/alice", calls = 0;
  const auth = new Authentication({ identity: () => identity, recover: async () => { identity = "other/alice"; } });
  await expect(auth.wrap(async () => { calls++; return denied; })(request)).rejects.toMatchObject({ reason: "identity-changed" });
  expect(calls).toBe(1); auth.dispose();
  let logins = 0;
  const bounded = new Authentication({ identity: () => "alice", recover: async () => { logins++; } });
  await expect(bounded.wrap(async () => denied)(request)).rejects.toMatchObject({ reason: "retry-limit" }); expect(logins).toBe(1); bounded.dispose();
});

test("pre-abort never sends, disposal interrupts transport, invalid deadlines reject", async () => {
  const auth = new Authentication({ identity: () => "alice", recover: async () => {} }); let calls = 0;
  const wrapped = auth.wrap(async () => { calls++; return new Promise(() => {}); });
  const controller = new AbortController(); controller.abort();
  await expect(wrapped({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" }); expect(calls).toBe(0);
  const pending = wrapped(request); auth.dispose();
  await expect(pending).rejects.toBeInstanceOf(AuthenticationError);
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.1]) expect(() => new Authentication({ identity: () => "alice", recover: async () => {}, timeoutMs })).toThrow();
});

test("fetch transport merges configured headers and request cancellation", async () => {
  const previous = globalThis.fetch; let sent: RequestInit | undefined;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { sent = init; return new Response("ok"); }) as typeof fetch;
  try {
    const controller = new AbortController();
    const transport: Transport = fetchTransport("https://example.invalid", { credentials: "include", headers: { "x-app": "mail", Authorization: "old" } });
    await transport({ ...request, headers: { authorization: "fresh" }, signal: controller.signal });
    expect(new Headers(sent?.headers).get("x-app")).toBe("mail"); expect(new Headers(sent?.headers).get("authorization")).toBe("fresh");
    expect(sent?.credentials).toBe("include"); expect(sent?.signal).toBe(controller.signal);
  } finally { globalThis.fetch = previous; }
});
