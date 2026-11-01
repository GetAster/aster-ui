import { $ } from "../../shared/dom.ts";

type Scheme = "system" | "light" | "dark";
const SCHEMES: readonly Scheme[] = ["system", "light", "dark"];
const OPTION_PREFIX = "doc-scheme-option-";

const media = matchMedia("(prefers-color-scheme: dark)");
const resolve = (value: Scheme): "light" | "dark" => value === "system" ? (media.matches ? "dark" : "light") : value;

let appearance: { choose(value: Scheme): void } | undefined;

/** Programmatic selection, used when a URL such as ?scheme=dark drives a demo. */
export function setAppearance(value: Scheme): void {
  if (appearance) appearance.choose(value);
  else {
    try { localStorage.setItem("aster-docs-scheme", value); } catch { /* Storage is optional. */ }
    document.documentElement.dataset.scheme = resolve(value);
  }
}

export function initAppearance(onChange?: (scheme: string) => void): void {
  const button = $<HTMLButtonElement>("#doc-scheme");
  const label = button.querySelector<HTMLElement>(".scheme-value")!;
  const list = $("#doc-scheme-options");
  const options = [...list.querySelectorAll<HTMLElement>("[role=option]")];
  const valueOf = (option: HTMLElement) => option.dataset.scheme as Scheme;
  let scheme: Scheme = "system";
  try {
    const saved = localStorage.getItem("aster-docs-scheme");
    if (saved && SCHEMES.includes(saved as Scheme)) scheme = saved as Scheme;
  } catch { /* Storage is optional. */ }
  const indexOf = (value: Scheme) => Math.max(0, options.findIndex(option => valueOf(option) === value));
  let active = indexOf(scheme);
  const apply = () => {
    document.documentElement.dataset.scheme = resolve(scheme);
    label.textContent = options[indexOf(scheme)]!.textContent;
    for (const option of options) option.setAttribute("aria-selected", String(valueOf(option) === scheme));
    try { localStorage.setItem("aster-docs-scheme", scheme); } catch { /* Storage is optional. */ }
    onChange?.(resolve(scheme));
  };
  const open = () => {
    button.setAttribute("aria-expanded", "true");
    list.hidden = false;
    activate(indexOf(scheme));
  };
  const close = () => {
    button.setAttribute("aria-expanded", "false");
    button.removeAttribute("aria-activedescendant");
    list.hidden = true;
  };
  const activate = (i: number) => {
    active = i;
    button.setAttribute("aria-activedescendant", `${OPTION_PREFIX}${valueOf(options[i]!)}`);
    for (const [j, option] of options.entries()) option.toggleAttribute("data-active", j === i);
  };
  const choose = (value: Scheme) => {
    scheme = value;
    close();
    apply();
  };
  button.addEventListener("click", () => { if (button.getAttribute("aria-expanded") === "true") close(); else open(); });
  button.addEventListener("blur", close);
  button.addEventListener("keydown", e => {
    if (button.getAttribute("aria-expanded") !== "true") {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); open(); }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); activate(Math.min(options.length - 1, active + 1)); break;
      case "ArrowUp": e.preventDefault(); activate(Math.max(0, active - 1)); break;
      case "Home": e.preventDefault(); activate(0); break;
      case "End": e.preventDefault(); activate(options.length - 1); break;
      case "Enter": case " ": e.preventDefault(); choose(valueOf(options[active]!)); break;
      case "Escape": e.preventDefault(); close(); break;
      case "Tab": close(); break;
      default: {
        if (e.key.length !== 1 || !/\S/.test(e.key)) break;
        const k = e.key.toLowerCase();
        for (let step = 1; step <= options.length; step++) {
          const i = (active + step) % options.length;
          if (options[i]!.textContent!.toLowerCase().startsWith(k)) { activate(i); break; }
        }
      }
    }
  });
  for (const option of options) {
    // Keeping focus on the button; pointerdown is cancelled so WebKit retains it,
    // and touch selection happens on pointerup for the same reason.
    option.addEventListener("pointerdown", e => e.preventDefault());
    option.addEventListener("pointerup", e => { if (e.pointerType === "touch" && !list.hidden) choose(valueOf(option)); });
    option.addEventListener("click", () => { if (!list.hidden) choose(valueOf(option)); });
  }
  document.addEventListener("pointerdown", e => { if (!list.hidden && !(e.target as Element).closest(".scheme-picker")) close(); });
  media.addEventListener("change", apply);
  appearance = { choose };
  apply();
}
