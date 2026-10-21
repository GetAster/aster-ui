import type { CompositeDefinition } from "./definition.ts";

type Commands = NonNullable<CompositeDefinition["commands"]>;
export interface CommandPlan {
  readonly order: readonly string[];
  readonly errors: readonly { readonly path: string; readonly message: string }[];
}

/** Resolve declared aliases by dependency, independent of object key order. */
export function planCommands(commands: Commands, accepts: (reference: string) => boolean): CommandPlan {
  const state = new Map<string, "visiting" | "valid" | "invalid">();
  const order: string[] = [];
  const errors: { path: string; message: string }[] = [];
  function visit(key: string, chain: readonly string[]): boolean {
    switch (state.get(key)) {
      case "valid": return true;
      case "invalid": return false;
      case "visiting":
        errors.push({ path: `definition.commands.${key}.use`, message: `Command reference cycle: ${[...chain, key].join(" → ")}` }); return false;
    }
    if (chain.length >= 128) {
      errors.push({ path: `definition.commands.${key}.use`, message: "Command alias chain exceeds 128 links" }); state.set(key, "invalid"); return false;
    }
    state.set(key, "visiting");
    const reference = commands[key]!.use;
    const alias = reference.startsWith("commands.") ? reference.slice("commands.".length) : undefined;
    let valid: boolean;
    if (alias !== undefined && Object.hasOwn(commands, alias)) valid = visit(alias, [...chain, key]);
    else {
      valid = accepts(reference);
      if (!valid) errors.push({ path: `definition.commands.${key}.use`, message: `Expected a declared Command reference; unknown or incompatible '${reference}'` });
    }
    state.set(key, valid ? "valid" : "invalid");
    if (valid) order.push(key);
    return valid;
  }
  Object.keys(commands).forEach(key => visit(key, []));
  return { order, errors };
}

/** Suggest aliases which are valid and cannot introduce a cycle at this destination. */
export function commandTargets(commands: Commands, base: readonly string[], destination?: string): readonly string[] {
  const references = new Set(base);
  const plan = planCommands(commands, reference => references.has(reference));
  const dependsOn = (key: string, target: string): boolean => {
    const seen = new Set<string>();
    while (Object.hasOwn(commands, key) && !seen.has(key)) {
      if (key === target) return true;
      seen.add(key);
      const reference = commands[key]!.use;
      if (!reference.startsWith("commands.")) return false;
      key = reference.slice("commands.".length);
    }
    return false;
  };
  for (const key of plan.order) if (!destination || !dependsOn(key, destination)) references.add(`commands.${key}`);
  return [...references];
}
