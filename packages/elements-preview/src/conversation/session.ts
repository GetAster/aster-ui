import { Lifetime } from "@getaster/data";
import { batch, signal } from "@preact/signals-core";

/** Adapter-provided ordering and boundary cursors; display time is independent. */
export interface ConversationEntry {
  readonly id: string;
  readonly order: string;
  readonly cursor: string;
  readonly author: string;
  readonly time: string;
  readonly text: string;
  readonly kind?: "message" | "note" | "event";
  readonly discussion?: string;
  readonly contexts?: readonly { readonly id: string; readonly label: string }[];
  readonly revision?: string;
  readonly data?: unknown;
}

export type ConversationTarget = "latest" | { readonly entryId: string };
export interface ConversationWindow {
  readonly entries: readonly ConversationEntry[];
  readonly hasOlder: boolean;
  readonly hasNewer: boolean;
}
export interface ConversationAdapter {
  open(request: { scope: string; at: ConversationTarget; signal: AbortSignal }): Promise<ConversationWindow>;
  older(request: { scope: string; before: string; signal: AbortSignal }): Promise<ConversationWindow>;
  newer(request: { scope: string; after: string; signal: AbortSignal }): Promise<ConversationWindow>;
  /** Must return the confirmed server entry; replay/idempotency belongs to the adapter. */
  send?(request: { scope: string; text: string; signal: AbortSignal }): Promise<ConversationEntry>;
}
export interface ConversationSessionOptions {
  readonly scope: string;
  readonly title: string;
  readonly adapter: ConversationAdapter;
  readonly maxEntries?: number;
}
export type ConversationOperation = "open" | "older" | "newer";

/** One bounded conversation window and draft. No DOM or implicit read receipts. */
export class ConversationSession {
  readonly lifetime = new Lifetime();
  readonly scope: string;
  readonly title: string;
  readonly adapter: ConversationAdapter;
  readonly maxEntries: number;
  readonly #entries = signal<readonly ConversationEntry[]>([]);
  readonly entries = this.#entries as import("@preact/signals-core").ReadonlySignal<readonly ConversationEntry[]>;
  readonly #busy = signal<ConversationOperation | undefined>(undefined);
  readonly busy = this.#busy as import("@preact/signals-core").ReadonlySignal<ConversationOperation | undefined>;
  readonly #error = signal<string | undefined>(undefined);
  readonly error = this.#error as import("@preact/signals-core").ReadonlySignal<string | undefined>;
  readonly #hasOlder = signal(false);
  readonly hasOlder = this.#hasOlder as import("@preact/signals-core").ReadonlySignal<boolean>;
  readonly #hasNewer = signal(false);
  readonly hasNewer = this.#hasNewer as import("@preact/signals-core").ReadonlySignal<boolean>;
  readonly #sending = signal(false);
  readonly sending = this.#sending as import("@preact/signals-core").ReadonlySignal<boolean>;
  readonly #sendError = signal<string | undefined>(undefined);
  readonly sendError = this.#sendError as import("@preact/signals-core").ReadonlySignal<string | undefined>;
  readonly draft = signal("");
  #request: AbortController | undefined;
  #generation = 0;
  #retry: { operation: ConversationOperation; at: ConversationTarget; protectedIds: readonly string[] } | undefined;
  #send: Promise<boolean> | undefined;
  #updateKind: "history" | "receive" = "history";
  get updateKind(): "history" | "receive" { return this.#updateKind; }

  constructor(options: ConversationSessionOptions) {
    if (!options.scope.trim()) throw new Error("Conversation scope is required.");
    const maximum = options.maxEntries ?? 120;
    if (!Number.isInteger(maximum) || maximum < 10) throw new Error("maxEntries must be an integer of at least 10.");
    this.scope = options.scope; this.title = options.title; this.adapter = options.adapter; this.maxEntries = maximum;
    this.lifetime.defer(() => { this.#generation++; this.#request?.abort(); this.#busy.value = undefined; });
  }

  open(at: ConversationTarget = "latest"): Promise<boolean> { return this.#load("open", at, []); }
  loadOlder(protectedIds: readonly string[] = []): Promise<boolean> {
    if (!this.#hasOlder.peek() || this.#busy.peek()) return Promise.resolve(false);
    return this.#load("older", "latest", protectedIds);
  }
  loadNewer(protectedIds: readonly string[] = []): Promise<boolean> {
    if (!this.#hasNewer.peek() || this.#busy.peek()) return Promise.resolve(false);
    return this.#load("newer", "latest", protectedIds);
  }
  retry(protectedIds?: readonly string[]): Promise<boolean> {
    const attempt = this.#retry;
    return attempt ? this.#load(attempt.operation, attempt.at, protectedIds ?? attempt.protectedIds) : Promise.resolve(false);
  }

  /** Confirmed updates merge by ID. Older revision conflicts must be resolved by the host. */
  receive(entry: ConversationEntry, protectedIds: readonly string[] = []): boolean {
    if (this.lifetime.disposed) return false;
    validateEntries([entry]);
    const previous = this.#entries.peek();
    const existing = previous.find(item => item.id === entry.id);
    // A notification is not proof that the unloaded gap before it is contiguous.
    if (!existing && this.#hasNewer.peek()) return false;
    const merged = mergeEntries(previous, [entry]);
    const retained = merged.slice(-this.maxEntries);
    if (protectedIds.some(id => merged.some(item => item.id === id) && !retained.some(item => item.id === id))) { this.#hasNewer.value = true; return false; }
    batch(() => {
      this.#updateKind = "receive";
      if (merged.length > retained.length) this.#hasOlder.value = true;
      this.#entries.value = retained;
    });
    return true;
  }

  /** Applies a confirmed deletion/access revocation without retaining a hidden copy. */
  remove(entryId: string): void {
    if (this.lifetime.disposed) return;
    const previous = this.#entries.peek();
    const retained = previous.filter(entry => entry.id !== entryId);
    if (retained.length !== previous.length) this.#entries.value = retained;
  }

  send(protectedIds: () => readonly string[] = () => []): Promise<boolean> {
    if (this.#send) return this.#send;
    const send = this.adapter.send, text = this.draft.peek();
    if (!send || !text.trim() || this.lifetime.disposed) return Promise.resolve(false);
    this.#sending.value = true; this.#sendError.value = undefined;
    const pending = (async () => {
      try {
        const entry = await Promise.resolve().then(() => send.call(this.adapter, { scope: this.scope, text, signal: this.lifetime.signal }));
        if (this.lifetime.disposed) return false;
        this.receive(entry, protectedIds());
        if (this.draft.peek() === text) this.draft.value = "";
        return true;
      } catch (error) {
        if (!this.lifetime.disposed) this.#sendError.value = errorText(error);
        return false;
      } finally { this.#sending.value = false; this.#send = undefined; }
    })();
    this.#send = pending;
    return pending;
  }

  dispose(): void { this.lifetime.dispose(); }

  async #load(operation: ConversationOperation, at: ConversationTarget, protectedIds: readonly string[]): Promise<boolean> {
    if (this.lifetime.disposed) return false;
    this.#request?.abort();
    const request = new AbortController(), generation = ++this.#generation;
    this.#request = request; this.#busy.value = operation; this.#error.value = undefined;
    const abort = () => request.abort();
    this.lifetime.signal.addEventListener("abort", abort, { once: true });
    try {
      const current = this.#entries.peek();
      let page: ConversationWindow;
      switch (operation) {
        case "open": page = await this.adapter.open({ scope: this.scope, at, signal: request.signal }); break;
        case "older": page = await this.adapter.older({ scope: this.scope, before: current[0]!.cursor, signal: request.signal }); break;
        case "newer": page = await this.adapter.newer({ scope: this.scope, after: current.at(-1)!.cursor, signal: request.signal }); break;
      }
      if (request.signal.aborted || generation !== this.#generation) return false;
      validateEntries(page.entries);
      if (operation === "open" && at !== "latest" && !page.entries.some(entry => entry.id === at.entryId)) throw new Error("That message is no longer available. Return or open the latest messages.");
      const merged = operation === "open" ? mergeEntries([], page.entries) : mergeEntries(this.#entries.peek(), page.entries);
      let start = operation === "older" ? 0 : Math.max(0, merged.length - this.maxEntries);
      if (operation === "open" && at !== "latest") start = Math.max(0, Math.min(merged.findIndex(entry => entry.id === at.entryId) - Math.floor(this.maxEntries / 2), merged.length - this.maxEntries));
      const retained = merged.slice(start, start + this.maxEntries);
      const trimmedOlder = start > 0, trimmedNewer = start + retained.length < merged.length;
      if (operation !== "open" && page.entries.every(entry => this.#entries.peek().some(existing => existing.id === entry.id)) && (operation === "older" ? page.hasOlder : page.hasNewer)) throw new Error("The history adapter did not advance. Retry after checking its boundary cursor.");
      if (operation !== "open" && protectedIds.some(id => merged.some(entry => entry.id === id) && !retained.some(entry => entry.id === id))) throw new Error("Finish reading or editing this message before loading another window.");
      batch(() => {
        this.#updateKind = "history";
        this.#entries.value = retained;
        this.#hasOlder.value = operation === "newer" ? this.#hasOlder.peek() || trimmedOlder : page.hasOlder || trimmedOlder;
        this.#hasNewer.value = operation === "older" ? this.#hasNewer.peek() || trimmedNewer : page.hasNewer || trimmedNewer;
      });
      this.#retry = undefined;
      return true;
    } catch (error) {
      if (!request.signal.aborted && generation === this.#generation) {
        this.#error.value = errorText(error); this.#retry = { operation, at, protectedIds };
      }
      return false;
    } finally {
      this.lifetime.signal.removeEventListener("abort", abort);
      if (generation === this.#generation) { this.#busy.value = undefined; this.#request = undefined; }
    }
  }
}

function validateEntries(entries: readonly ConversationEntry[]): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || !entry.cursor || typeof entry.order !== "string" || typeof entry.text !== "string" || ids.has(entry.id)) throw new Error("Conversation entries require unique IDs, boundary cursors and text.");
    ids.add(entry.id);
  }
}
function mergeEntries(previous: readonly ConversationEntry[], incoming: readonly ConversationEntry[]): readonly ConversationEntry[] {
  const entries = new Map(previous.map(entry => [entry.id, entry]));
  for (const entry of incoming) entries.set(entry.id, entry);
  return [...entries.values()].sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : "The conversation could not be updated."; }
