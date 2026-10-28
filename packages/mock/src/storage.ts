export interface Dump {
  data: Record<string, unknown[]>;
  /** Internal concurrency counters, keyed by set and key predicate. Keep with data when persisting. */
  revisions?: Record<string, Record<string, string>>;
}

export interface MockStorage {
  load(): Promise<Dump | undefined>;
  save(dump: Dump): Promise<void>;
}

const STORE = "dump";
const KEY = "dump";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Keeps the dump in one IndexedDB record (browsers only). */
export function indexedDbStorage(name: string): MockStorage {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return {
    async load() {
      const db = await open();
      try {
        const v = await request(db.transaction(STORE).objectStore(STORE).get(KEY));
        return v as Dump | undefined;
      } finally {
        db.close();
      }
    },
    async save(dump) {
      const db = await open();
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(dump, KEY);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
  };
}
