const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Runs a DOM change as a view transition, so a container with a
 * `view-transition-name` morphs to its new shape and the content fades in
 * after it. Without support, or with reduced motion, the change just happens.
 */
export function morph(change: () => void): void {
  if (!document.startViewTransition || reduced()) {
    change();
    return;
  }
  document.startViewTransition(change);
}

/** Selects the colour scheme, cross-fading the whole page. */
export function setScheme(scheme: "light" | "dark", animate = true): void {
  const apply = () => {
    document.documentElement.dataset.scheme = scheme;
  };
  if (animate) morph(apply);
  else apply();
}
