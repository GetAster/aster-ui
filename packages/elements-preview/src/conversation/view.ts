import { AsterElement, Menu, compositeTypes as t, define, each, type View } from "@getaster/elements";
import type { Command } from "@getaster/data";
import { html, svg, nothing } from "lit-html";
import { ConversationSession, type ConversationEntry, type ConversationSessionOptions } from "./session.ts";

export interface ConversationPassage {
  readonly scope: string;
  readonly entry: ConversationEntry;
  readonly exact: string;
  readonly start: number;
  readonly end: number;
}
export type ConversationEntryRenderer = (entry: ConversationEntry) => View;
export type ConversationContextProvider = (entry: ConversationEntry, scope: string, signal: AbortSignal) => ConversationSessionOptions | undefined | Promise<ConversationSessionOptions | undefined>;
export type ConversationPassageProvider = (passage: ConversationPassage, signal: AbortSignal) => ConversationSessionOptions | undefined | Promise<ConversationSessionOptions | undefined>;
export type ConversationReaderActions = (session: ConversationSession) => readonly Command[];
export interface ConversationReadingLocation { readonly entryId?: string; readonly offset: number; readonly following: boolean }
const messageIcons = {
  copy: svg`<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-3h-8v8h3"/></svg>`,
  reply: svg`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6.5 3-4 4 4 4M3 7h5a5 5 0 0 1 5 5v1"/></svg>`,
};
interface Anchor { id: string; offset: number; index: number }

/** The independently retained reading region used by ConversationReader. */
export class ConversationPane extends AsterElement {
  readonly #session = this.prop<ConversationSession | undefined>(undefined);
  readonly #renderer = this.prop<ConversationEntryRenderer | undefined>(undefined);
  readonly #context = this.prop(false);
  readonly #passages = this.prop(false);
  readonly #following = this.prop(true);
  readonly #arrivals = this.prop(0);
  readonly #status = this.prop("");
  readonly #selection = this.prop<ConversationPassage | undefined>(undefined);
  readonly #auto = this.prop(true);
  readonly #focusEnabled = this.prop(false);
  readonly #readingOnly = this.prop(false);
  #restoreGeneration = 0;
  #selectionRange: Range | undefined;
  #anchor: Anchor | undefined;
  #ids: readonly string[] = [];
  #programmatic: number | undefined;
  #resize: ResizeObserver | undefined;
  #selectedTarget: string | undefined;
  #scroller: HTMLElement | undefined;
  #previous: readonly ConversationEntry[] = [];
  #current: ConversationSession | undefined;
  #focusedId: string | undefined;
  get session(): ConversationSession | undefined { return this.#session.value; }
  set session(value: ConversationSession | undefined) { this.#session.value = value; }
  get entryRenderer(): ConversationEntryRenderer | undefined { return this.#renderer.value; }
  set entryRenderer(value: ConversationEntryRenderer | undefined) { this.#renderer.value = value; }
  get contextEnabled(): boolean { return this.#context.value; }
  set contextEnabled(value: boolean) { this.#context.value = value; }
  get passagesEnabled(): boolean { return this.#passages.value; }
  set passagesEnabled(value: boolean) { this.#passages.value = value; if (!value) this.#selection.value = undefined; }
  get autoLoadHistory(): boolean { return this.#auto.value; }
  set autoLoadHistory(value: boolean) { this.#auto.value = value; }
  get focusEnabled(): boolean { return this.#focusEnabled.value; }
  set focusEnabled(value: boolean) { this.#focusEnabled.value = value; }
  get readingOnly(): boolean { return this.#readingOnly.value; }
  set readingOnly(value: boolean) { this.#readingOnly.value = value; }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resize = new ResizeObserver(() => this.#restore());
    const content = this.querySelector(".ac-entries");
    if (content) this.#resize.observe(content);
    if (this.#scroller) this.#resize.observe(this.#scroller);
    this.onDisconnect(() => this.#resize?.disconnect());
    this.listen(document, "selectionchange" as keyof WindowEventMap, () => this.#readSelection());
    this.listen(this, "contextmenu", event => {
      if ((event.target as Element).closest("aster-menu,textarea,input,[contenteditable]")) return;
      this.#readSelection();
      if (!this.#selection.peek()) return;
      event.preventDefault(); this.#showSelectionMenu({ x: event.clientX, y: event.clientY });
    });
    this.listen(this, "focusin", event => { this.#focusedId = (event.target as Element).closest<HTMLElement>("article[data-entry]")?.dataset["entry"]; });
    this.listen(this, "focusout", event => {
      const target = event.target as Node;
      if (event.relatedTarget && !this.contains(event.relatedTarget as Node)) this.#focusedId = undefined;
      else if (!event.relatedTarget) queueMicrotask(() => { if (target.isConnected && !target.contains(document.activeElement)) this.#focusedId = undefined; });
    });
  }

  /** Restore after a hidden region or responsive layout becomes visible. */
  restore(): void { requestAnimationFrame(() => { if (this.isConnected) this.#restore(); }); }
  focusReading(): void { this.#scroller?.focus({ preventScroll: true }); this.restore(); }
  location(): ConversationReadingLocation {
    this.#capture();
    return { ...(this.#anchor ? { entryId: this.#anchor.id } : {}), offset: this.#anchor?.offset ?? 0, following: this.#following.peek() };
  }
  async restoreLocation(location: ConversationReadingLocation): Promise<void> {
    const session = this.#session.peek(), generation = ++this.#restoreGeneration;
    if (!session) return;
    if (location.following && session.hasNewer.peek()) await session.open();
    else if (location.entryId && !session.entries.peek().some(entry => entry.id === location.entryId)) await session.open({ entryId: location.entryId });
    if (!this.isConnected || this.#session.peek() !== session || generation !== this.#restoreGeneration) return;
    this.#following.value = location.following;
    if (location.entryId) this.#anchor = { id: location.entryId, offset: location.offset, index: 0 };
    this.restore();
  }
  focusSource(entryId: string): void {
    const article = this.#article(entryId);
    (article?.querySelector<HTMLElement>(".ac-entry-actions button") ?? article ?? this.#scroller)?.focus({ preventScroll: true });
    this.restore();
  }
  receive(entry: ConversationEntry): boolean {
    const accepted = this.#session.peek()?.receive(entry, this.#protectedIds()) ?? false;
    if (!accepted) { this.#arrivals.value++; this.#status.value = "New activity is available. Use Latest to catch up."; }
    return accepted;
  }
  reveal(entryId: string): void {
    const article = this.#article(entryId);
    if (!article) return;
    this.#following.value = false;
    this.#anchor = { id: entryId, offset: 12, index: this.#ids.indexOf(entryId) };
    this.#restore(); article.focus({ preventScroll: true });
  }

  protected render(): View {
    const session = this.#session.value;
    if (!session) return html`<p class="ac-empty">Choose a conversation.</p>`;
    const entries = session.entries.value, busy = session.busy.value;
    const renderer = this.#renderer.value;
    return html`<header class="ac-pane-header"><div><p class="ac-kicker">Conversation</p><h2>${session.title}</h2></div>${this.#focusEnabled.value ? html`<button class="ac-focus-launch" type="button" aria-haspopup="dialog" aria-label=${`Read ${session.title} in focused reader`} title="Open focused reader" @click=${(event: MouseEvent) => { this.#capture(); this.emit("conversation-focus", { pane: this, opener: event.currentTarget as HTMLElement }); }}>↗</button>` : nothing}</header>
      <div class="ac-tools"><span>${this.#following.value ? "Following latest" : "Reading history"}</span><div><button type="button" @click=${() => this.#step(-1)} aria-label="Previous message">↑</button><button type="button" @click=${() => this.#step(1)} aria-label="Next message">↓</button><button type="button" @click=${() => this.#latest()}>Latest ↓</button></div></div>
      <div class="ac-scroll" tabindex="0" role="region" aria-label=${`${session.title}: message history`} aria-busy=${busy !== undefined} @scroll=${() => this.#scroll()} @keydown=${(event: KeyboardEvent) => this.#keys(event)}>
        <div class="ac-edge"><button type="button" ?disabled=${!!busy || !session.hasOlder.value} @click=${() => this.#older()}>${session.hasOlder.value ? "Load earlier messages" : entries.length ? "Beginning of loaded history" : "No messages loaded"}</button></div>
        <ol class="ac-entries">${each(entries, entry => entry.id, entry => html`<li><article class="ac-entry" data-entry=${entry.id} data-kind=${entry.kind ?? "message"} tabindex="-1" aria-label=${`${entry.author}, ${entry.time}`}><header><strong>${entry.author}</strong><time>${entry.time}</time>${entry.kind === "note" ? html`<span class="ac-badge">Internal note</span>` : nothing}</header>
          <div class="ac-message-controls" role="group" aria-label=${`Actions for ${entry.author}’s message`}>
            <button type="button" aria-label="Copy message" title="Copy message" @click=${() => void this.#copyText(entry.text, "Message copied.")}>${messageIcons.copy}</button>
            ${!this.#readingOnly.value && session.adapter.send && entry.kind !== "event" ? html`<button type="button" aria-label="Reply to conversation" title="Reply to conversation" @click=${() => this.querySelector<HTMLTextAreaElement>(".ac-composer textarea")?.focus({ preventScroll: true })}>${messageIcons.reply}</button>` : nothing}
          </div>
          ${renderer ? renderer(entry) : html`<div class="ac-body" data-passage-body>${entry.text}</div>`}
          <div class="ac-entry-actions">${this.#context.value && entry.discussion ? html`<button type="button" @click=${() => this.#requestContext(entry)}>Read discussion →</button>` : nothing}${this.#context.value ? (entry.contexts ?? []).map(link => html`<button type="button" @click=${() => this.#requestContext({ ...entry, discussion: link.id })}>${link.label} →</button>`) : nothing}</div>
        </article></li>`)}</ol>
        ${!entries.length && !busy && !session.error.value ? html`<p class="ac-empty">No messages in this conversation.</p>` : nothing}
        ${session.hasNewer.value ? html`<div class="ac-edge"><button type="button" ?disabled=${!!busy} @click=${() => this.#newer()}>Load newer messages</button></div>` : nothing}
      </div>
      <div class="ac-feedback"><aster-progress-status .busy=${!!busy} .error=${session.error.value} .pendingText=${busy === "older" ? "Loading earlier history…" : "Loading conversation…"} .completeText=${"History updated"} .reserveSpace=${true}></aster-progress-status>${session.error.value ? html`<button type="button" @click=${() => session.retry(this.#protectedIds())}>Retry history</button>` : nothing}${this.#arrivals.value ? html`<button type="button" @click=${() => this.#latest()}>${this.#arrivals.value} new ${this.#arrivals.value === 1 ? "message" : "messages"} · View latest ↓</button>` : nothing}${this.#selection.value && this.#passages.value ? html`<div class="ac-selection"><span>Text selected</span><button type="button" aria-haspopup="menu" @click=${(event: MouseEvent) => this.#showSelectionMenu(event.currentTarget as HTMLElement)}>Selection actions</button><button type="button" aria-label="Dismiss passage action" @click=${() => { this.#selection.value = undefined; }}>×</button></div>` : nothing}</div>
      ${this.#readingOnly.value ? nothing : html`<form class="ac-composer" @submit=${(event: Event) => { event.preventDefault(); void this.#send(); }}><label>Reply to ${session.title}<textarea aria-label=${`Reply to ${session.title}`} rows="2" .value=${session.draft.value} @input=${(event: Event) => { session.draft.value = (event.target as HTMLTextAreaElement).value; }}></textarea></label><footer><span>Your draft stays with this conversation</span><button type="submit" ?disabled=${!session.adapter.send || session.sending.value || !session.draft.value.trim()}>${session.sending.value ? "Sending…" : "Send reply ↗"}</button></footer>${session.sendError.value ? html`<p role="alert" class="ac-error">${session.sendError.value} Your draft is retained.</p>` : nothing}</form>`}
      <span class="ac-sr" role="status" aria-live="polite">${this.#status.value}</span><aster-menu class="ac-selection-menu"></aster-menu>`;
  }

  protected override updated(): void {
    this.#scroller = this.querySelector<HTMLElement>(".ac-scroll") ?? undefined;
    const session = this.#session.peek();
    if (!session) return;
    if (session !== this.#current) {
      this.#current = session; this.#previous = []; this.#anchor = undefined; this.#following.value = true; this.#arrivals.value = 0;
    }
    const entries = session.entries.peek();
    if (entries !== this.#previous) {
      const previousIds = new Set(this.#previous.map(entry => entry.id));
      const lastOrder = this.#previous.at(-1)?.order;
      const arrivals = lastOrder === undefined ? 0 : entries.filter(entry => !previousIds.has(entry.id) && entry.order > lastOrder).length;
      if (arrivals && !this.#following.peek() && session.updateKind === "receive") {
        this.#arrivals.value += arrivals; this.#status.value = "New activity is available. Your reading position is unchanged.";
      }
      this.#previous = entries;
    }
    this.#ids = entries.map(entry => entry.id);
    this.#restore();
  }

  #article(id: string): HTMLElement | undefined { return [...this.querySelectorAll<HTMLElement>("article[data-entry]")].find(article => article.dataset["entry"] === id); }
  #capture(): void {
    const scroller = this.#scroller;
    if (!scroller || !scroller.clientHeight) return;
    const top = scroller.getBoundingClientRect().top;
    const article = [...this.querySelectorAll<HTMLElement>("article[data-entry]")].find(item => item.getBoundingClientRect().bottom > top + 2);
    if (article) this.#anchor = { id: article.dataset["entry"]!, offset: article.getBoundingClientRect().top - top, index: this.#ids.indexOf(article.dataset["entry"]!) };
  }
  #restore(): void {
    const scroller = this.#scroller;
    if (!scroller?.clientHeight) return;
    if (this.#following.peek()) this.#setScroll(scroller.scrollHeight);
    else if (this.#anchor) {
      let article = this.#article(this.#anchor.id);
      if (!article) {
        const lostFocus = this.#focusedId === this.#anchor.id;
        article = this.#article(this.#ids[Math.min(this.#anchor.index, this.#ids.length - 1)] ?? "");
        if (article) { this.#anchor = { ...this.#anchor, id: article.dataset["entry"]! }; this.#status.value = "The previous message is unavailable. Showing a nearby message."; if (lostFocus) article.focus({ preventScroll: true }); }
      }
      if (article) this.#setScroll(scroller.scrollTop + article.getBoundingClientRect().top - scroller.getBoundingClientRect().top - this.#anchor.offset);
    }
    this.#capture();
  }
  #setScroll(top: number): void {
    if (!this.#scroller) return;
    this.#scroller.scrollTop = top; this.#programmatic = this.#scroller.scrollTop;
  }
  #scroll(): void {
    const scroller = this.#scroller;
    if (!scroller) return;
    if (this.#programmatic !== undefined && Math.abs(scroller.scrollTop - this.#programmatic) < 1) { this.#programmatic = undefined; return; }
    this.#programmatic = undefined;
    this.#following.value = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 24 && !this.#session.peek()?.hasNewer.peek();
    if (this.#following.peek()) this.#arrivals.value = 0;
    this.#capture();
    if (this.#auto.peek() && scroller.scrollTop < 60) void this.#older();
  }
  #protectedIds(): readonly string[] {
    const ids = new Set<string>();
    if (this.#anchor) ids.add(this.#anchor.id);
    const active = document.activeElement?.closest<HTMLElement>("article[data-entry]");
    if (active && this.contains(active)) ids.add(active.dataset["entry"]!);
    const selection = getSelection();
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      for (const article of this.querySelectorAll<HTMLElement>("article[data-entry]")) if (range.intersectsNode(article)) ids.add(article.dataset["entry"]!);
    }
    return [...ids];
  }
  async #older(): Promise<void> {
    const session = this.#session.peek();
    if (!session?.hasOlder.peek() || session.busy.peek()) return;
    this.#following.value = false; this.#capture(); await session.loadOlder(this.#protectedIds());
  }
  async #newer(): Promise<void> { this.#capture(); await this.#session.peek()?.loadNewer(this.#protectedIds()); }
  async #latest(): Promise<void> {
    const session = this.#session.peek();
    if (!session) return;
    const ok = await session.open();
    if (ok && this.isConnected) { this.#following.value = true; this.#arrivals.value = 0; this.#restore(); }
  }
  async #send(): Promise<void> {
    const session = this.#session.peek();
    if (session && await session.send(() => this.#protectedIds())) { this.#status.value = "Reply sent."; if (session.hasNewer.peek()) this.#arrivals.value++; }
  }
  #step(direction: number): void {
    const active = document.activeElement?.closest<HTMLElement>("article[data-entry]")?.dataset["entry"] ?? this.#selectedTarget ?? this.#anchor?.id;
    const index = active ? this.#ids.indexOf(active) : -1;
    const id = this.#ids[Math.max(0, Math.min(this.#ids.length - 1, index + direction))];
    if (id) { this.#selectedTarget = id; this.reveal(id); }
  }
  #keys(event: KeyboardEvent): void {
    if ((event.target as Element).closest("textarea,input,select,[contenteditable]")) return;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); this.#step(event.key === "ArrowUp" ? -1 : 1); }
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      this.#readSelection();
      const body = getSelection()?.anchorNode?.parentElement?.closest<HTMLElement>("[data-passage-body]");
      if (this.#selection.peek() && body) { event.preventDefault(); this.#showSelectionMenu(body); }
    }
    if (event.key === "Escape") this.#selection.value = undefined;
  }
  #requestContext(entry: ConversationEntry): void { this.#capture(); this.emit("conversation-context", { entry, scope: this.#session.peek()!.scope, pane: this }); }
  #requestPassage(passage: ConversationPassage): void { this.#capture(); this.#selection.value = undefined; this.emit("conversation-passage", { passage, pane: this }); }
  #readSelection(): void {
    const selected = getSelection();
    if (selected?.rangeCount && !selected.isCollapsed && this.contains(selected.anchorNode) && this.contains(selected.focusNode)
      && selected.anchorNode?.parentElement?.closest(".ac-scroll") && this.#following.peek()) {
      this.#capture(); this.#following.value = false;
    }
    if (!this.#passages.peek() || this.#renderer.peek()) return;
    if (this.querySelector(".ac-selection")?.contains(document.activeElement) || this.querySelector("aster-menu")?.contains(document.activeElement)) return;
    const selection = getSelection();
    const element = (node: Node | null | undefined) => node instanceof Element ? node : node?.parentElement;
    const start = element(selection?.anchorNode)?.closest<HTMLElement>("[data-passage-body]");
    const end = element(selection?.focusNode)?.closest<HTMLElement>("[data-passage-body]");
    if (!selection?.rangeCount || selection.isCollapsed || !start || start !== end || !this.contains(start) || !selection.toString().trim()) { this.#selection.value = undefined; return; }
    const entry = this.#session.peek()?.entries.peek().find(item => item.id === start.closest<HTMLElement>("[data-entry]")?.dataset["entry"]);
    if (!entry || entry.kind === "event" || start.textContent !== entry.text) return;
    const range = selection.getRangeAt(0), prefix = range.cloneRange();
    prefix.selectNodeContents(start); prefix.setEnd(range.startContainer, range.startOffset);
    const offset = prefix.toString().length;
    if (!this.#selection.peek()) { this.#capture(); this.#following.value = false; }
    this.#selectionRange = range.cloneRange();
    this.#selection.value = { scope: this.#session.peek()!.scope, entry, exact: range.toString(), start: offset, end: offset + range.toString().length };
  }
  #showSelectionMenu(anchor: HTMLElement | { x: number; y: number }): void {
    const passage = this.#selection.peek(), menu = this.querySelector<Menu>("aster-menu"), range = this.#selectionRange;
    if (!passage || !menu) return;
    const restore = () => { if (range?.startContainer.isConnected) { const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); } };
    const items = [
      { label: "Copy", run: () => { restore(); void this.#copyText(passage.exact, "Selected text copied."); } },
      { label: "Discuss passage…", run: () => { restore(); this.#requestPassage(passage); } },
    ];
    const opener = this.#article(passage.entry.id) ?? this.#scroller ?? null;
    if (anchor instanceof HTMLElement) menu.openFrom(anchor, items, "Selected text", opener ?? anchor);
    else menu.openAt(anchor, items, "Selected text", opener);
  }
  async #copyText(text: string, confirmation: string): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text); this.#status.value = confirmation;
    } catch { this.#status.value = "Copy unavailable. Select the message text and use your browser’s copy shortcut."; }
  }
}
define("aster-conversation-pane", ConversationPane);

interface Context { key: string; session: ConversationSession }
/** Root session is borrowed. Context sessions created through providers are owned. */
export class ConversationReader extends AsterElement {
  static readonly tag = "aster-conversation-reader";
  static readonly contract = Object.freeze({
    session: t.optional(t.instance(ConversationSession)),
    contextProvider: t.optional(t.custom("conversation context provider", (value): value is ConversationContextProvider => typeof value === "function", { asterType: "function" })),
    passageProvider: t.optional(t.custom("passage discussion provider", (value): value is ConversationPassageProvider => typeof value === "function", { asterType: "function" })),
    entryRenderer: t.optional(t.custom("conversation entry renderer", (value): value is ConversationEntryRenderer => typeof value === "function", { asterType: "function" })),
    autoLoadHistory: t.optional(t.boolean),
    focusModeEnabled: t.optional(t.boolean),
    readerActions: t.optional(t.custom("focused reader command provider", (value): value is ConversationReaderActions => typeof value === "function", { asterType: "function" })),
  });
  readonly #session = this.prop<ConversationSession | undefined>(undefined);
  readonly #context = this.prop<ConversationContextProvider | undefined>(undefined);
  readonly #passage = this.prop<ConversationPassageProvider | undefined>(undefined);
  readonly #renderer = this.prop<ConversationEntryRenderer | undefined>(undefined);
  readonly #auto = this.prop(true);
  readonly #contexts = this.prop<readonly Context[]>([]);
  readonly #trail = this.prop<readonly string[]>([]);
  readonly #busy = this.prop(false);
  readonly #error = this.prop<string | undefined>(undefined);
  readonly #focusEnabled = this.prop(true);
  readonly #readerActions = this.prop<ConversationReaderActions | undefined>(undefined);
  readonly #readerSession = this.prop<ConversationSession | undefined>(undefined);
  readonly #readerOpen = this.prop(false);
  readonly #readerTitleId = `ac-reader-${crypto.randomUUID()}`;
  readonly #readerLocations = new Map<string, ConversationReadingLocation>();
  #readerOrigin: { pane: ConversationPane; location: ConversationReadingLocation; opener: HTMLElement | null } | undefined;
  #focusGeneration = 0;
  #request: AbortController | undefined;
  #generation = 0;
  #root: ConversationSession | undefined;
  #returnFocus: { pane: ConversationPane; entryId: string }[] = [];
  get session(): ConversationSession | undefined { return this.#session.value; }
  set session(value: ConversationSession | undefined) { if (this.#session.peek() !== value) this.#reset(); this.#session.value = value; }
  get contextProvider(): ConversationContextProvider | undefined { return this.#context.value; }
  set contextProvider(value: ConversationContextProvider | undefined) { this.#context.value = value; }
  get passageProvider(): ConversationPassageProvider | undefined { return this.#passage.value; }
  set passageProvider(value: ConversationPassageProvider | undefined) { this.#passage.value = value; }
  get entryRenderer(): ConversationEntryRenderer | undefined { return this.#renderer.value; }
  set entryRenderer(value: ConversationEntryRenderer | undefined) { this.#renderer.value = value; }
  get autoLoadHistory(): boolean { return this.#auto.value; }
  set autoLoadHistory(value: boolean) { this.#auto.value = value; }
  get focusModeEnabled(): boolean { return this.#focusEnabled.value; }
  set focusModeEnabled(value: boolean) { this.#focusEnabled.value = value; if (!value) this.closeReader(); }
  get readerActions(): ConversationReaderActions | undefined { return this.#readerActions.value; }
  set readerActions(value: ConversationReaderActions | undefined) { this.#readerActions.value = value; }
  get contextCount(): number { return this.#contexts.peek().length; }
  /** Routes confirmed notifications through the viewport's focus/selection protection. */
  receive(scope: string, entry: ConversationEntry): boolean {
    const panes = [...this.querySelectorAll<ConversationPane>("aster-conversation-pane")];
    const pane = (this.#readerOpen.peek() ? panes.find(item => item.classList.contains("ac-reader-pane") && item.session?.scope === scope) : undefined) ?? panes.find(item => item.session?.scope === scope);
    return pane?.receive(entry) ?? false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const context = (event: Event) => {
      const { entry, scope, pane } = (event as CustomEvent<{ entry: ConversationEntry; scope: string; pane: ConversationPane }>).detail;
      const provider = this.#context.peek(); if (provider) void this.#open(signal => provider(entry, scope, signal), pane, entry.id);
    };
    const passage = (event: Event) => {
      const { passage, pane } = (event as CustomEvent<{ passage: ConversationPassage; pane: ConversationPane }>).detail;
      const provider = this.#passage.peek(); if (provider) void this.#open(signal => provider(passage, signal), pane, passage.entry.id, true);
    };
    this.addEventListener("conversation-context", context); this.addEventListener("conversation-passage", passage);
    const focus = (event: Event) => { const { pane, opener } = (event as CustomEvent<{ pane: ConversationPane; opener: HTMLElement }>).detail; this.showReader(pane.session?.scope, opener); };
    this.addEventListener("conversation-focus", focus);
    this.onDisconnect(() => { this.removeEventListener("conversation-context", context); this.removeEventListener("conversation-passage", passage); this.removeEventListener("conversation-focus", focus); this.#reset(); });
  }

  /** Opens a reading-only view of the active discussion or an explicitly retained scope. */
  showReader(scope = this.#trail.peek().at(-1) ?? this.#session.peek()?.scope, opener: HTMLElement | null = document.activeElement as HTMLElement | null): void {
    if (!this.#focusEnabled.peek() || !scope || this.#readerOpen.peek()) return;
    const pane = [...this.querySelectorAll<ConversationPane>("aster-conversation-pane:not(.ac-reader-pane)")].find(item => item.session?.scope === scope);
    if (!pane?.session) throw new Error("Open the conversation before opening its focused reader.");
    this.#readerOrigin = { pane, location: pane.location(), opener };
    this.#readerSession.value = pane.session; this.#readerOpen.value = true;
    const generation = ++this.#focusGeneration;
    queueMicrotask(() => {
      const dialog = this.querySelector<HTMLDialogElement>(".ac-focus-dialog");
      if (!dialog || !this.isConnected || generation !== this.#focusGeneration) return;
      dialog.showModal();
      const reader = this.querySelector<ConversationPane>(".ac-reader-pane")!;
      const location = this.#readerLocations.get(scope) ?? this.#readerOrigin!.location;
      void reader.restoreLocation(location).then(() => { if (generation === this.#focusGeneration && this.#readerOpen.peek()) reader.focusReading(); });
    });
  }
  closeReader(): void {
    const dialog = this.querySelector<HTMLDialogElement>(".ac-focus-dialog");
    if (dialog?.open) dialog.close();
    else if (this.#readerOpen.peek()) { this.#readerOpen.value = false; this.#focusGeneration++; this.#readerOrigin = undefined; }
  }

  async #readerClosed(): Promise<void> {
    const session = this.#readerSession.peek(), pane = this.querySelector<ConversationPane>(".ac-reader-pane");
    if (session && pane) this.#readerLocations.set(session.scope, pane.location());
    const origin = this.#readerOrigin; this.#readerOrigin = undefined;
    this.#readerOpen.value = false; const generation = ++this.#focusGeneration;
    if (!origin) return;
    await origin.pane.restoreLocation(origin.location);
    if (generation !== this.#focusGeneration) return;
    if (origin.opener?.isConnected) origin.opener.focus({ preventScroll: true });
    else origin.pane.focusReading();
  }

  returnToSource(): void {
    this.#request?.abort(); this.#generation++; this.#busy.value = false;
    this.#trail.value = this.#trail.peek().slice(0, -1);
    const source = this.#returnFocus.pop();
    requestAnimationFrame(() => { if (source?.pane.isConnected) source.pane.focusSource(source.entryId); });
  }

  protected render(): View {
    const trail = this.#trail.value, active = trail.at(-1), session = this.#session.value;
    const focused = this.#readerSession.value;
    const pane = (value: ConversationSession, root: boolean) => html`<aster-conversation-pane class=${root ? "ac-main" : "ac-context-pane"} ?hidden=${!root && active !== value.scope} .session=${value} .entryRenderer=${this.#renderer.value} .autoLoadHistory=${this.#auto.value} .contextEnabled=${!!this.#context.value} .passagesEnabled=${!!this.#passage.value} .focusEnabled=${this.#focusEnabled.value}></aster-conversation-pane>`;
    return html`<div class="ac-reader" ?data-context=${!!active}>
      ${session ? pane(session, true) : nothing}
      <section class="ac-context" ?hidden=${!active} aria-label="Focused discussion"><div class="ac-return"><button type="button" @click=${() => this.returnToSource()}>← ${trail.length > 1 ? "Return to source discussion" : "Return to reading position"}</button><button type="button" aria-label="Return from discussion" @click=${() => this.returnToSource()}>×</button></div>${each(this.#contexts.value, item => item.key, item => pane(item.session, false))}</section>
    </div><div class="ac-reader-feedback"><aster-progress-status .busy=${this.#busy.value} .error=${this.#error.value} .pendingText=${"Opening discussion…"} .completeText=${"Discussion opened"} .reserveSpace=${false}></aster-progress-status></div>
    <dialog class="ac-focus-dialog" aria-labelledby=${this.#readerTitleId} @close=${() => void this.#readerClosed()}><header class="ac-focus-toolbar"><div><p class="ac-kicker">Focused reading</p><h2 id=${this.#readerTitleId}>${focused?.title ?? "Conversation"}</h2></div><div class="ac-focus-actions"><aster-command-bar .commands=${focused ? this.#readerActions.value?.(focused) ?? [] : []} .label=${"Reader actions"}></aster-command-bar><button type="button" class="ac-reader-close" aria-label="Close focused reader" title="Close focused reader (Escape)" @click=${() => this.closeReader()}>×</button></div></header><div class="ac-focus-body">${focused ? html`<aster-conversation-pane class="ac-reader-pane" .session=${focused} .entryRenderer=${this.#renderer.value} .autoLoadHistory=${this.#auto.value} .readingOnly=${true}></aster-conversation-pane>` : nothing}</div><footer class="ac-focus-footer">Escape to return · Your reply draft stays in the conversation</footer></dialog>`;
  }
  protected override updated(): void {
    if (this.#root !== this.#session.peek()) this.#root = this.#session.peek();
    for (const pane of this.querySelectorAll<ConversationPane>("aster-conversation-pane")) if (!pane.hidden) pane.restore();
  }
  #reset(): void {
    this.#readerOrigin = undefined; this.#focusGeneration++; this.closeReader(); this.#readerOpen.value = false; this.#readerSession.value = undefined; this.#readerLocations.clear();
    this.#generation++; this.#request?.abort(); this.#request = undefined; this.#busy.value = false;
    for (const context of this.#contexts.peek()) context.session.dispose();
    this.#contexts.value = []; this.#trail.value = []; this.#returnFocus = []; this.#error.value = undefined;
  }
  async #open(provider: (signal: AbortSignal) => ConversationSessionOptions | undefined | Promise<ConversationSessionOptions | undefined>, pane: ConversationPane, entryId: string, creates = false): Promise<void> {
    this.#request?.abort();
    const request = new AbortController(), generation = ++this.#generation;
    this.#request = request; this.#busy.value = true; this.#error.value = undefined;
    try {
      if (creates && this.#contexts.peek().length >= 8) throw new Error("Eight discussions are retained. Leave this workspace before creating another discussion.");
      const options = await provider(request.signal);
      if (!options || request.signal.aborted || generation !== this.#generation || !this.isConnected) return;
      if (options.scope === this.#session.peek()?.scope || this.#trail.peek().includes(options.scope)) throw new Error("This discussion is already open. Use Return to go back to it.");
      let context = this.#contexts.peek().find(item => item.key === options.scope);
      if (!context) {
        if (this.#contexts.peek().length >= 8) throw new Error("Eight discussions are retained. Reuse an open discussion or leave this workspace before opening more.");
        context = { key: options.scope, session: new ConversationSession(options) };
        this.#contexts.value = [...this.#contexts.peek(), context];
      }
      this.#returnFocus.push({ pane, entryId }); this.#trail.value = [...this.#trail.peek(), context.key];
      if (!context.session.entries.peek().length) void context.session.open();
      requestAnimationFrame(() => { if (generation === this.#generation) this.#activePane()?.focusReading(); });
    } catch (error) {
      if (!request.signal.aborted && generation === this.#generation) this.#error.value = error instanceof Error ? error.message : "The discussion could not be opened.";
    } finally { if (generation === this.#generation) { this.#busy.value = false; this.#request = undefined; } }
  }
  #activePane(): ConversationPane | undefined { return [...this.querySelectorAll<ConversationPane>("aster-conversation-pane")].find(pane => pane.session?.scope === this.#trail.peek().at(-1)); }
}
define("aster-conversation-reader", ConversationReader);
