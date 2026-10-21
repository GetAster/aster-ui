// The raw C ABI of odata_mock.wasm: UTF-8 JSON in, `(ptr << 32) | len` out.
// It's a wasm32-wasip1 build, so std's clock, randomness and panic output
// arrive through the six WASI calls below, supplied per instance.

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  mock_init(ptr: number, len: number): bigint;
  mock_handle(ptr: number, len: number): bigint;
  mock_dump(): bigint;
}

export interface WasmEngine {
  init(input: unknown): void;
  handle(input: unknown): unknown;
  dump(): unknown;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type WasmSource = BufferSource | URL | string;

export async function loadWasmBytes(source: WasmSource): Promise<BufferSource> {
  if (typeof source !== "string" && !(source instanceof URL)) return source;
  const url = source instanceof URL ? source : new URL(source, import.meta.url);
  if (typeof Bun !== "undefined" && url.protocol === "file:") {
    return await Bun.file(url).arrayBuffer();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url}: ${res.status}`);
  return await res.arrayBuffer();
}

/** `now` is the engine's wall clock in epoch milliseconds, so a frozen app clock freezes `now()` in queries too. */
export async function instantiate(bytes: BufferSource, now: () => number = Date.now): Promise<WasmEngine> {
  let memory: WebAssembly.Memory | undefined;
  const view = () => new DataView(memory!.buffer);
  const wasi = {
    clock_time_get(id: number, _precision: bigint, out: number): number {
      const ms = id === 0 ? now() : performance.now();
      view().setBigUint64(out, BigInt(Math.round(ms * 1e6)), true);
      return 0;
    },
    random_get(ptr: number, len: number): number {
      crypto.getRandomValues(new Uint8Array(memory!.buffer, ptr, len));
      return 0;
    },
    environ_sizes_get(count: number, size: number): number {
      view().setUint32(count, 0, true);
      view().setUint32(size, 0, true);
      return 0;
    },
    environ_get: () => 0,
    fd_write(_fd: number, iovs: number, n: number, written: number): number {
      let total = 0;
      for (let i = 0; i < n; i++) {
        const ptr = view().getUint32(iovs + i * 8, true);
        const len = view().getUint32(iovs + i * 8 + 4, true);
        console.error(decoder.decode(new Uint8Array(memory!.buffer, ptr, len)));
        total += len;
      }
      view().setUint32(written, total, true);
      return 0;
    },
    proc_exit(code: number): never {
      throw new Error(`mock: the engine exited with ${code}`);
    },
  };
  const { instance } = (await WebAssembly.instantiate(bytes, {
    wasi_snapshot_preview1: wasi,
  })) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
  const x = instance.exports as unknown as Exports;
  memory = x.memory;

  // Memory can grow during any call, so views are taken after each one.
  const takeResult = (packed: bigint): string => {
    const ptr = Number(packed >> 32n);
    const len = Number(packed & 0xffffffffn);
    const text = decoder.decode(new Uint8Array(x.memory.buffer, ptr, len));
    x.dealloc(ptr, len);
    return text;
  };
  const withInput = (input: unknown, fn: (ptr: number, len: number) => bigint): unknown => {
    const bytes = encoder.encode(JSON.stringify(input));
    const ptr = x.alloc(bytes.length);
    new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
    const packed = fn(ptr, bytes.length);
    x.dealloc(ptr, bytes.length);
    return JSON.parse(takeResult(packed));
  };
  const failOnError = (out: unknown): unknown => {
    const e = (out as { error?: unknown } | null)?.error;
    if (typeof e === "string") throw new Error(`mock: ${e}`);
    return out;
  };

  return {
    init: (input) => void failOnError(withInput(input, x.mock_init)),
    handle: (input) => failOnError(withInput(input, x.mock_handle)),
    dump: () => failOnError(JSON.parse(takeResult(x.mock_dump()))),
  };
}
