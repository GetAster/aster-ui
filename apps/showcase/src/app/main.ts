import { signal } from "@preact/signals-core";
import { html } from "lit-html";
import { AsterElement, Composite, define, type View } from "@getaster/elements";
import type { Theme } from "../workspace/themes.ts";
import compiled from "./showcase.ui.yaml";
import { showcaseAuthoring } from "./registry.ts";
import { bindShowcaseRouting } from "./routing.ts";

const definition = showcaseAuthoring.validate(compiled.definition, compiled.sources);

/** The route owns selection; the declared model derives the visible surface. */
export class ShowcasePage extends AsterElement {
  readonly #theme = this.prop<Theme>("lamplight");
  readonly #scheme = this.prop<"light" | "dark">("light");
  readonly #active = signal("all");
  #workspace: Composite | undefined;
  get theme(): Theme { return this.#theme.value; }
  set theme(value: Theme) { this.#theme.value = value; }
  get scheme(): "light" | "dark" { return this.#scheme.value; }
  set scheme(value: "light" | "dark") { this.#scheme.value = value; }
  protected render(): View { return html`<div class="showcase-workspace"></div>`; }
  protected override updated(): void {
    if (this.#workspace) return;
    this.#workspace = new Composite(definition, showcaseAuthoring.registry, {
      inputs: { active: this.#active, theme: this.#theme, scheme: this.#scheme },
      placement: showcaseAuthoring.placement(definition, place => html`
        <div class="showcase-browser"><aside>${place("navigation")}</aside><section aria-label="Component examples">${place("gallery")}${place("preview")}</section></div>`),
    }).mount(this.querySelector<HTMLElement>(".showcase-workspace")!);
    this.onDisconnect(bindShowcaseRouting(this, this.#active, this.#theme, this.#scheme));
  }
  override disconnectedCallback(): void {
    this.#workspace?.dispose(); this.#workspace = undefined;
    super.disconnectedCallback();
  }
}
define("aster-showcase-page", ShowcasePage);
