import { effect, signal, untracked } from "@preact/signals-core";
import { html, nothing } from "lit-html";
import { progressPolicy, type ProgressPolicy, type PageScope } from "@getaster/data";
import "../progress/status.ts";
import { AsterElement, define, scopeOf, uid, type View } from "../base/element.ts";

/** Browser preferences and CSS-owned content dimensions, refreshed by the host. */
export interface ComponentEnvironment {
  /** Surface content width in CSS pixels, observed rather than computed by layout code. */
  readonly width: number;
  /** Surface content height in CSS pixels. */
  readonly height: number;
  /** Non-zero surface, visible document and no inherited visibility:hidden. Offscreen scrolling does not pause it. */
  readonly visible: boolean;
  /** The live prefers-reduced-motion preference. */
  readonly reducedMotion: boolean;
  /** The live forced-colors preference. */
  readonly forcedColors: boolean;
  /** Explicit host locale, nearest lang or browser language. */
  readonly locale: string;
  /** Computed CSS direction of the host. */
  readonly direction: string;
  /** Browser device pixel ratio. */
  readonly pixelRatio: number;
  /** Current CSS token values; vendor-specific colour conversion belongs in its adapter. */
  readonly theme: Readonly<Record<"surface" | "text" | "muted" | "rule" | "accent" | "positive" | "negative", string>>;
  /** Computed CSS font family. */
  readonly font: string;
}

/** One mount's private DOM and cancellation boundary. */
export interface ComponentMount {
  /** Private subtree for this mount; stale asynchronous work cannot touch a later mount's node. */
  readonly node: HTMLElement;
  /** Aborted on replacement, retry, disconnect or update failure. */
  readonly signal: AbortSignal;
  /** Initial browser environment; subsequent values arrive through update. */
  readonly environment: ComponentEnvironment;
  /** Nearest scope; borrowed, never disposed by the host. */
  readonly scope: PageScope | undefined;
}

/** A mounted vendor component. Every resource created by mount belongs here. */
export interface ComponentSession {
  /** Synchronous signal reads are tracked; called again when they or the environment change. */
  update(environment: ComponentEnvironment): void;
  /** Stops subscriptions, vendor listeners, observers and vendor rendering. Called exactly once. */
  dispose(): void;
}

/** Vendor-neutral lifecycle. Lazy imports belong in mount and must honour its signal. */
export interface ComponentAdapter {
  /** Acquires a session; check cancellation after awaits and release partial acquisitions before throwing. */
  mount(context: ComponentMount): ComponentSession | Promise<ComponentSession>;
}

/** A stable vendor-owned surface with an independently rendered accessible alternative. */
export class ComponentHost extends AsterElement {
  readonly #progressPolicy = this.prop<ProgressPolicy>({});
  readonly #adapter = this.prop<ComponentAdapter | undefined>(undefined);
  readonly #alternative = this.prop<(() => View) | undefined>(undefined);
  readonly #label = this.prop("Chart");
  readonly #locale = this.prop<string | undefined>(undefined);
  readonly #attempt = signal(0);
  readonly #status = this.prop<"waiting" | "loading" | "ready" | "error">("waiting");
  readonly #environment = signal<ComponentEnvironment | undefined>(undefined);
  readonly #id = uid("aster-component");
  #surface: HTMLElement | undefined;
  #abort: AbortController | undefined;
  #session: ComponentSession | undefined;
  #stopUpdate: (() => void) | undefined;
  #generation = 0;
  #size = { width: 0, height: 0 };
  #refresh: (() => void) | undefined;

  get progressPolicy(): ProgressPolicy { return this.#progressPolicy.value; }
  set progressPolicy(value: ProgressPolicy) { progressPolicy(value); this.#progressPolicy.value = Object.freeze({ ...value }); }

  /** Replacing the adapter disposes its previous session and mounts afresh when visible. */
  get adapter(): ComponentAdapter | undefined { return this.#adapter.value; }
  set adapter(value: ComponentAdapter | undefined) { this.#adapter.value = value; }
  /** Required: HTML data and keyboard actions equivalent to the visual content. */
  get alternative(): (() => View) | undefined { return this.#alternative.value; }
  set alternative(value: (() => View) | undefined) { this.#alternative.value = value; }
  /** Visible heading and accessible name for this component. */
  get label(): string { return this.#label.value; }
  set label(value: string) { this.#label.value = value; }
  /** Defaults to the nearest lang attribute, then the browser language. */
  get locale(): string | undefined { return this.#locale.value; }
  set locale(value: string | undefined) { this.#locale.value = value; }

  /** Retries a failed mount or update with a fresh DOM node. */
  retry(): void { this.#attempt.value++; }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#surface = this.querySelector<HTMLElement>(".aster-component-surface")!;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const contrast = matchMedia("(forced-colors: active)");
    const refresh = () => {
      if (!this.isConnected) return;
      const style = getComputedStyle(this);
      const token = (name: string) => style.getPropertyValue(`--aster-${name}`).trim();
      const next: ComponentEnvironment = {
        ...this.#size,
        visible: this.#size.width > 0 && this.#size.height > 0 && !document.hidden && style.visibility !== "hidden",
        reducedMotion: motion.matches, forcedColors: contrast.matches,
        locale: this.#locale.peek() ?? this.closest("[lang]")?.getAttribute("lang") ?? navigator.language,
        direction: style.direction, pixelRatio: devicePixelRatio,
        theme: { surface: token("surface"), text: token("text"), muted: token("text-2"), rule: token("rule"), accent: token("accent"), positive: token("positive"), negative: token("negative") },
        font: style.fontFamily,
      };
      if (JSON.stringify(next) !== JSON.stringify(this.#environment.peek())) this.#environment.value = next;
    };
    this.#refresh = refresh;
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      this.#size = { width: entry.contentRect.width, height: entry.contentRect.height };
      refresh();
    });
    resize.observe(this.#surface);
    const attributes = new MutationObserver((records) => {
      if (records.some((r) => r.target instanceof Element && r.target.contains(this))) refresh();
    });
    attributes.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["class", "style", "hidden", "lang", "dir", "data-identity", "data-scheme", "data-density"] });
    for (const media of [motion, contrast]) media.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", refresh);
    document.addEventListener("load", refresh, true);
    window.addEventListener("resize", refresh);
    refresh();
    this.onDisconnect(() => {
      resize.disconnect(); attributes.disconnect();
      for (const media of [motion, contrast]) media.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", refresh);
      document.removeEventListener("load", refresh, true);
      window.removeEventListener("resize", refresh);
      this.#refresh = undefined;
    });
    this.onDisconnect(effect(() => {
      const adapter = this.#adapter.value;
      const alternative = this.#alternative.value;
      this.#attempt.value;
      untracked(() => {
        this.#dispose();
        this.#status.value = "waiting";
        if (!adapter || !alternative) return;
        const generation = this.#generation;
        const stop = effect(() => {
          const environment = this.#environment.value;
          if (environment?.visible) untracked(() => {
            if (!this.#abort && this.#status.peek() !== "error") void this.#mount(adapter, environment, generation);
          });
        });
        this.#stopUpdate = stop;
      });
    }));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#dispose();
    this.#environment.value = undefined;
    this.#size = { width: 0, height: 0 };
  }

  protected render(): View {
    this.#locale.value;
    const status = this.#status.value;
    const alternative = this.#alternative.value;
    return html`<section class="aster-component" aria-labelledby=${this.#id}>
      <h3 id=${this.#id}>${this.#label.value}</h3>
      <div class="aster-component-surface" aria-hidden="true"></div>
      <div class="aster-component-status"><aster-progress-status .busy=${status === "loading"}
        .error=${status === "error" ? "Visualisation unavailable." : !alternative ? "Provide an accessible alternative to enable this visualisation." : undefined}
        .progressPolicy=${this.#progressPolicy.value} .pendingText=${"Loading visualisation…"} .completeText=${"Visualisation ready"}></aster-progress-status>
        ${status === "error" ? html`<button class="aster-button" type="button" @click=${() => this.retry()}>Retry visualisation</button>` : nothing}</div>
      <div class="aster-component-alternative" role="region" aria-label=${`${this.#label.value} data and actions`} tabindex="0">${alternative?.() ?? nothing}</div>
    </section>`;
  }

  protected override updated(): void { this.#refresh?.(); }

  async #mount(adapter: ComponentAdapter, environment: ComponentEnvironment, generation: number): Promise<void> {
    const abort = new AbortController();
    this.#abort = abort;
    const node = document.createElement("div");
    node.className = "aster-component-content";
    this.#surface!.replaceChildren(node);
    this.#status.value = "loading";
    try {
      const session = await adapter.mount({ node, signal: abort.signal, environment, scope: scopeOf(this) });
      if (generation !== this.#generation || abort.signal.aborted) {
        session.dispose();
        return;
      }
      this.#session = session;
      this.#stopUpdate?.();
      this.#stopUpdate = effect(() => {
        const current = this.#environment.value;
        if (!current) return;
        try { session.update(current); }
        catch (error) { queueMicrotask(() => this.#fail(error, generation)); }
      });
      this.#status.value = "ready";
    } catch (error) { this.#fail(error, generation); }
  }

  #fail(error: unknown, generation: number): void {
    if (generation !== this.#generation || !this.isConnected) return;
    this.#dispose();
    this.#status.value = "error";
    this.emit("component-error", error);
  }

  #dispose(): void {
    this.#generation++;
    this.#abort?.abort(); this.#abort = undefined;
    this.#stopUpdate?.(); this.#stopUpdate = undefined;
    const session = this.#session; this.#session = undefined;
    try { session?.dispose(); }
    catch (error) { this.emit("component-error", error); }
    this.#surface?.replaceChildren();
  }
}

define("aster-component", ComponentHost);
