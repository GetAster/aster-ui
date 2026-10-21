import { batch, signal, type Signal } from "@preact/signals-core";
import { DEFAULT_PROGRESS_POLICY, progressPolicy, type ProgressPolicy } from "@getaster/data";

const policies = new WeakMap<Element, Signal<ProgressPolicy>>();
const revision = signal(0);

/** Configure application/region defaults; mounted descendants follow changes. */
export function provideProgressPolicy(root: Element, options: ProgressPolicy): void {
  progressPolicy(options);
  const snapshot = Object.freeze({ ...options });
  batch(() => {
    const existing = policies.get(root);
    if (existing) existing.value = snapshot;
    else policies.set(root, signal(snapshot));
    revision.value++;
  });
}

/** Merge application/region providers, including shadow hosts, from outer to inner. */
export function progressPolicyOf(element: Element): Readonly<Required<ProgressPolicy>> {
  revision.value;
  const chain: ProgressPolicy[] = [];
  for (let node: Node | null = element; node; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
    const policy = node instanceof Element ? policies.get(node)?.value : undefined;
    if (policy) chain.push(policy);
  }
  return Object.freeze(Object.assign({}, DEFAULT_PROGRESS_POLICY, ...chain.reverse()));
}
