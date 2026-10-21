// Unsaved work kept in the browser, so a reload doesn't lose it: one
// IndexedDB store of plain-data drafts by key ("Fields/[12]").

export interface Drafts {
  load<T>(key: string): Promise<T | undefined>;
  save(key: string, draft: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const STORE = "drafts";

/** Drafts in IndexedDB; when it can't be opened (a private window may refuse), they live only as long as the page. */
export function indexedDbDrafts(name = "aster-drafts"): Drafts {
  const memory = new Map<string, unknown>();
  const db = new Promise<IDBDatabase | undefined>((resolve) => {
    try {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  const run = async (mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest, fallback: () => unknown): Promise<unknown> => {
    const d = await db;
    if (!d) return fallback();
    return new Promise((resolve, reject) => {
      const req = op(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    load: async <T>(key: string) => (await run("readonly", (s) => s.get(key), () => memory.get(key))) as T | undefined,
    save: async (key, draft) => {
      await run("readwrite", (s) => s.put(draft, key), () => memory.set(key, draft));
    },
    remove: async (key) => {
      await run("readwrite", (s) => s.delete(key), () => memory.delete(key));
    },
    keys: async () => ((await run("readonly", (s) => s.getAllKeys(), () => [...memory.keys()])) as IDBValidKey[]).map(String),
  };
}
