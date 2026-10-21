import type { ODataResponse } from "@getaster/data";
import { createMockService, type MockService, type MockServiceOptions } from "../src/index.ts";

const dir = new URL("../../../fixtures/aster/", import.meta.url);
export const metadata = (await Bun.file(new URL("metadata.json", dir)).json()) as object;
export const seed = (await Bun.file(new URL("data.json", dir)).json()) as Record<string, unknown[]>;

export const NOW = "2026-10-15T10:00:00Z";

export function service(extra: Partial<MockServiceOptions> = {}): Promise<MockService> {
  return createMockService({ metadata, data: seed, now: () => NOW, ...extra });
}

// biome-ignore lint/suspicious/noExplicitAny: test JSON
export const json = (r: ODataResponse): any => JSON.parse(r.body);

export const get = (s: MockService, url: string, headers: Record<string, string> = {}) =>
  s.transport({ method: "GET", url, headers });

export const send = (
  s: MockService,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  s.transport({
    method,
    url,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
