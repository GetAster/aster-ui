import { signal, type ReadonlySignal } from "@preact/signals-core";
import { Window, type WindowPlacement } from "./window.ts";

export interface WorkspaceEntry { readonly id: string; readonly window: Window }
export interface WorkspaceSnapshot {
  version: 1;
  windows: { id: string; open: boolean; placement: WindowPlacement }[];
  active: string | null;
}

/** Coordinates registered windows through their public lifecycle only. */
export class Workspace {
  readonly #entries = signal<readonly WorkspaceEntry[]>([]);
  readonly #active = signal<string | null>(null);
  readonly #cleanup = new Map<string, () => void>();
  #restoring = false;
  #generation = 0;

  get entries(): readonly WorkspaceEntry[] { return this.#entries.value; }
  get active(): ReadonlySignal<string | null> { return this.#active; }

  register(id: string, window: Window): () => void {
    if (!id || this.#cleanup.has(id) || this.#entries.peek().some(entry => entry.window === window)) throw new Error("Workspace windows require unique IDs and elements");
    const activate = () => {
      for (const entry of this.#entries.peek()) if (entry.window !== window) entry.window.deactivate();
      this.#active.value = id;
      this.#entries.value = [...this.#entries.peek().filter(entry => entry.id !== id), { id, window }];
    };
    const leave = () => {
      if (window.open && window.state !== "minimized") return;
      if (this.#active.peek() !== id) return;
      this.#active.value = null;
      if (this.#restoring) return;
      const next = [...this.#entries.peek()].reverse().find(entry => entry.window.open && entry.window.state !== "minimized");
      if (next) next.window.activate();
    };
    window.addEventListener("activate", activate);
    window.addEventListener("close", leave);
    window.addEventListener("statechange", leave);
    this.#entries.value = [...this.#entries.peek(), { id, window }];
    let registered = true;
    const remove = () => {
      if (!registered) return;
      registered = false;
      window.removeEventListener("activate", activate);
      window.removeEventListener("close", leave);
      window.removeEventListener("statechange", leave);
      window.deactivate();
      this.#cleanup.delete(id);
      this.#entries.value = this.#entries.peek().filter(entry => entry.id !== id);
      if (this.#active.peek() === id) {
        this.#active.value = null;
        if (!this.#restoring) [...this.#entries.peek()].reverse().find(entry => entry.window.open && entry.window.state !== "minimized")?.window.activate();
      }
    };
    this.#cleanup.set(id, remove);
    return remove;
  }

  show(id: string, opener?: HTMLElement | null): void {
    if (document.querySelector("dialog:modal")) return;
    this.#find(id).show(opener);
  }

  /** Cycles visible windows; hosts choose a shortcut that suits their page. */
  cycle(backwards = false): void {
    if (document.querySelector("dialog:modal")) return;
    const visible = this.#entries.peek().filter(entry => entry.window.open && entry.window.state !== "minimized");
    // Registration order is not stable after activation; sort IDs for predictable cycling.
    visible.sort((a, b) => a.id.localeCompare(b.id));
    if (!visible.length) return;
    const current = visible.findIndex(entry => entry.id === this.#active.peek());
    visible[(current + (backwards ? -1 : 1) + visible.length) % visible.length]!.window.activate();
  }

  snapshot(): WorkspaceSnapshot {
    return { version: 1, windows: this.#entries.peek().map(entry => ({ id: entry.id, open: entry.window.open, placement: entry.window.placement() })), active: this.#active.peek() };
  }

  /** Applies placement to registered windows only; never creates content or closes dirty windows. */
  restore(snapshot: WorkspaceSnapshot): void {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.windows)) throw new TypeError("Invalid workspace snapshot");
    const known = snapshot.windows.filter(saved => this.#cleanup.has(saved.id));
    const ids = new Set<string>();
    for (const saved of known) {
      if (ids.has(saved.id) || typeof saved.open !== "boolean") throw new TypeError("Invalid workspace entry");
      ids.add(saved.id);
      const p = saved.placement;
      if (!p || !["normal", "maximized", "minimized"].includes(p.state) || (p.bounds && (![p.bounds.x, p.bounds.y, p.bounds.width, p.bounds.height].every(Number.isFinite) || p.bounds.width <= 0 || p.bounds.height <= 0))) throw new TypeError("Invalid workspace placement");
    }
    const generation = ++this.#generation;
    this.#restoring = true;
    this.#active.value = null;
    for (const entry of this.#entries.peek()) entry.window.deactivate();
    try {
      for (const saved of known) {
        const window = this.#find(saved.id);
        if (saved.open) window.show(null);
        window.setPlacement(saved.placement);
      }
    } finally { this.#restoring = false; }
    requestAnimationFrame(() => {
      if (generation !== this.#generation) return;
      for (const saved of known) {
        const window = this.#entries.peek().find(entry => entry.id === saved.id)?.window;
        if (!window) continue;
        if (window.open && window.state !== "minimized") { window.deactivate(); window.activate(false); }
      }
      const active = this.#entries.peek().find(entry => entry.id === snapshot.active && entry.window.open && entry.window.state !== "minimized");
      active?.window.activate();
    });
  }

  dispose(): void {
    this.#generation++;
    this.#restoring = true;
    for (const remove of [...this.#cleanup.values()]) remove();
    this.#restoring = false;
  }

  #find(id: string): Window {
    const entry = this.#entries.peek().find(entry => entry.id === id);
    if (!entry) throw new Error(`Unknown workspace window: ${id}`);
    return entry.window;
  }
}
