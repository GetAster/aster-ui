import { html } from "lit-html";
import { AsterElement, define, type CompositeFactory, type View } from "@getaster/elements";

/** A separate browsing context isolates each demo's data and releases it on deactivation. */
class ShowcasePreview extends AsterElement {
  readonly #file = this.prop("");
  readonly #title = this.prop("");
  readonly #theme = this.prop("lamplight");
  readonly #scheme = this.prop("light");
  get file(): string { return this.#file.value; }
  set file(value: string) { this.#file.value = value; }
  override get title(): string { return this.#title.value; }
  override set title(value: string) { this.#title.value = value; }
  get theme(): string { return this.#theme.value; }
  set theme(value: string) { this.#theme.value = value; }
  get scheme(): string { return this.#scheme.value; }
  set scheme(value: string) { this.#scheme.value = value; }
  #source: { file: string; url: string } | undefined;
  #appearance(): void {
    const frame = this.querySelector<HTMLIFrameElement>("iframe");
    frame?.contentWindow?.postMessage({ type: "aster-example-appearance", theme: this.#theme.peek(), scheme: this.#scheme.peek() }, location.origin);
  }
  protected override updated(): void { this.#appearance(); }
  protected render(): View {
    const root = new URL(document.querySelector<HTMLMetaElement>('meta[name="aster-library-root"]')?.content ?? "../", document.baseURI);
    const url = new URL(`playground/${this.#file.value}`, root);
    url.searchParams.set("theme", this.#theme.value);
    url.searchParams.set("scheme", this.#scheme.value);
    url.searchParams.set("embedded", "1");
    url.searchParams.set("app", new URL(".", document.baseURI).pathname);
    if (this.#source?.file !== this.#file.value) this.#source = { file: this.#file.value, url: url.href };
    return html`<div class="showcase-preview-head"><h1>Component showcase</h1><a href=${url.href.replace("embedded=1", "showcase=1")}>Open full example ↗</a></div>
      <p class="showcase-preview-note">Previews restart when you choose another category. Open the full example to keep working independently.</p>
      <iframe class="showcase-live-preview" title=${`${this.#title.value} example`} src=${this.#source.url} @load=${() => this.#appearance()}></iframe>`;
  }
}
define("aster-showcase-preview", ShowcasePreview);
export const createPreview: CompositeFactory = () => ({ element: document.createElement("aster-showcase-preview") });
