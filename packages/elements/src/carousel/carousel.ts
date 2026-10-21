import { html, nothing } from "lit-html";
import { AsterElement, define, each, uid, type View } from "../base/element.ts";

export interface Slide {
  readonly id?: string;
  /** Names the slide, after its position ("2 of 5: Brand refresh"). */
  readonly label: string;
  readonly view: View;
}

/**
 * A row of cards that snaps one at a time, the next one peeking in (the APG
 * carousel pattern, without rotation): Previous and Next, and "n of m" said
 * as it changes. Scrolling, swiping and the buttons all move it; the current
 * slide is whichever is most in view. When every slide fits, there are no
 * buttons.
 */
export class Carousel extends AsterElement {
  readonly #slides = this.prop<readonly Slide[]>([]);
  readonly #label = this.prop("");
  readonly #index = this.prop(0);
  /** The slides don't all fit: only then are there places to move to. */
  readonly #overflows = this.prop(false);
  #resize: ResizeObserver | undefined;
  #resizeFrame = 0;
  readonly #id = uid("aster-carousel");
  #observer: IntersectionObserver | undefined;
  /** Rebuilt when descriptors change or the element reconnects. */
  #observed: readonly Slide[] | undefined;
  #restoreId: string | undefined;
  #restoreFocus: HTMLElement | undefined;

  get slides(): readonly Slide[] {
    return this.#slides.value;
  }
  set slides(v: readonly Slide[]) {
    const ids = v.filter(s => s.id !== undefined).map(s => s.id);
    if (new Set(ids).size !== ids.length || ids.some(id => !id)) throw new TypeError("Carousel slide IDs must be unique and nonempty");
    const current = this.#slides.peek()[this.#index.peek()]?.id;
    const active = document.activeElement;
    this.#restoreFocus = active instanceof HTMLElement && active.closest("aster-carousel") === this ? active : undefined;
    this.#restoreId = current && v.some(s => s.id === current) ? current : undefined;
    this.#slides.value = [...v];
  }
  get label(): string {
    return this.#label.value;
  }
  set label(v: string) {
    this.#label.value = v;
  }
  /** The slide most in view. */
  get index(): number {
    return this.#index.value;
  }

  /** Brings a slide into view (smoothly unless motion is reduced). */
  show(index: number): void {
    const slides = this.#slideEls();
    const target = slides[Math.max(0, Math.min(slides.length - 1, index))];
    const rail = this.querySelector<HTMLElement>(".aster-carousel-rail");
    if (!target || !rail) return;
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    const rtl = getComputedStyle(this).direction === "rtl";
    const first = slides[0];
    const left = first ? rtl ? target.offsetLeft + target.offsetWidth - first.offsetLeft - first.offsetWidth : target.offsetLeft - first.offsetLeft : 0;
    rail.scrollTo({ left, behavior: behavior as ScrollBehavior });
  }

  override disconnectedCallback(): void {
    this.#observer?.disconnect();
    this.#resize?.disconnect();
    cancelAnimationFrame(this.#resizeFrame);
    this.#resizeFrame = 0;
    this.#observed = undefined;
    super.disconnectedCallback();
  }

  protected render(): View {
    const slides = this.#slides.value;
    const index = Math.min(this.#index.value, Math.max(0, slides.length - 1));
    const arrow = (back: boolean) => html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d=${back ? "m10 3-5 5 5 5" : "m6 3 5 5-5 5"}/></svg>`;
    return html`<section class="aster-carousel" aria-roledescription="carousel" aria-label=${this.#label.value}>
      <div class="aster-carousel-rail" id=${`${this.#id}-rail`}>
        ${each(slides.map((slide, index) => ({ slide, index })), x => x.slide.id === undefined ? `index:${x.index}` : `id:${x.slide.id}`, ({ slide: s, index: i }) => html`<div class="aster-carousel-slide" role="group" aria-roledescription="slide"
            aria-label=${`${i + 1} of ${slides.length}: ${s.label}`} data-index=${i}>${s.view}</div>`)}
      </div>
      ${slides.length > 1 && this.#overflows.value
        ? html`<div class="aster-carousel-nav">
            <span aria-live="polite" aria-atomic="true">${index + 1} of ${slides.length}</span>
            <button type="button" aria-controls=${`${this.#id}-rail`} aria-label="Previous" title="Previous" ?disabled=${index === 0} @click=${() => this.show(index - 1)}>${arrow(true)}</button>
            <button type="button" aria-controls=${`${this.#id}-rail`} aria-label="Next" title="Next" ?disabled=${index === slides.length - 1} @click=${() => this.show(index + 1)}>${arrow(false)}</button>
          </div>`
        : nothing}
    </section>`;
  }

  protected override updated(): void {
    if (this.#observed !== this.#slides.peek()) {
      this.#observe();
      if (this.#restoreId) {
        const index = this.#slides.peek().findIndex(s => s.id === this.#restoreId);
        this.#restoreId = undefined;
        if (index >= 0) {
          this.#index.value = index;
          const rail = this.querySelector<HTMLElement>(".aster-carousel-rail"), slide = this.#slideEls()[index], first = this.#slideEls()[0];
          if (rail && slide && first) rail.scrollLeft = getComputedStyle(this).direction === "rtl" ? slide.offsetLeft + slide.offsetWidth - first.offsetLeft - first.offsetWidth : slide.offsetLeft - first.offsetLeft;
        }
      }
    }
    const focused = this.#restoreFocus;
    this.#restoreFocus = undefined;
    if (focused?.isConnected && (document.activeElement === document.body || document.activeElement === focused)) focused.focus({ preventScroll: true });
  }

  /** The slide most in view becomes current. */
  #observe(): void {
    const rail = this.querySelector<HTMLElement>(".aster-carousel-rail");
    if (!rail) return;
    this.#observer?.disconnect();
    this.#observed = this.#slides.peek();
    this.#index.value = Math.min(this.#index.peek(), Math.max(0, this.#slides.peek().length - 1));
    const ratios = new Map<number, number>();
    this.#observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.index), e.intersectionRatio);
        let best = this.#index.peek();
        let most = -1;
        for (const [i, r] of ratios) if (r > most + 0.01 || (Math.abs(r - most) <= 0.01 && i < best)) [best, most] = [i, r];
        if (most > 0) this.#index.value = best;
      },
      { root: rail, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of this.#slideEls()) this.#observer.observe(el);
    this.#resize?.disconnect();
    this.#resize = new ResizeObserver(() => {
      // Adding navigation changes the rail's layout; commit outside observer delivery.
      if (this.#resizeFrame) return;
      this.#resizeFrame = requestAnimationFrame(() => {
        this.#resizeFrame = 0;
        this.#overflows.value = rail.scrollWidth > rail.clientWidth + 1;
      });
    });
    this.#resize.observe(rail);
    for (const el of this.#slideEls()) this.#resize.observe(el);
  }

  #slideEls(): HTMLElement[] {
    return [...this.querySelectorAll<HTMLElement>(".aster-carousel-slide")].filter(el => el.closest("aster-carousel") === this);
  }
}

define("aster-carousel", Carousel);
