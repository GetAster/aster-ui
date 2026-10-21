// Builds the API reference from the packages' public exports: one entry per
// symbol, keyed `kind:Owner.name` (the 15.0 reference's shape, so both can be
// measured alike). Signatures, defaults and one-line summaries come from the
// code; longer text, examples and see-also links come from docs/reference/*.md,
// merged in by `merge.ts`.
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

export type Kind =
  | "class"
  | "attr"
  | "method"
  | "event"
  | "classAttr"
  | "classMethod"
  | "object"
  | "type"
  | "staticMethod"
  | "constant"
  | "group";

export interface Param {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly description: string;
}

export interface Entry {
  readonly ref: string;
  readonly kind: Kind;
  readonly name: string;
  readonly package: string;
  /** `class:X` or `object:X` for a member; absent at the top level. */
  readonly definingClass?: string;
  /** For an element: its tag. */
  readonly tag?: string;
  readonly inheritsFrom?: string;
  readonly valueType?: string;
  readonly defaultValue?: string;
  /** `R` read-only, `RW` settable. */
  readonly flags?: string;
  readonly params?: readonly Param[];
  readonly returns?: { readonly type: string; readonly description: string };
  description: string;
  seeAlso: string[];
  examples: string[];
  groups: string[];
  readonly source: string;
  readonly deprecated?: string;
}

const PACKAGES = [
  { name: "data", index: "packages/data/src/index.ts" },
  { name: "elements", index: "packages/elements/src/index.ts" },
  { name: "mock", index: "packages/mock/src/index.ts" },
];

/** Members every element has from HTMLElement or the base lifecycle; not part of an element's own API. */
const LIFECYCLE = new Set(["connectedCallback", "disconnectedCallback", "attributeChangedCallback", "adoptedCallback", "render", "updated", "control", "row", "describe", "write", "constructor"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.ts$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

/** `define("aster-x", X)` calls: class name to tag. */
function tags(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files(join(ROOT, "packages/elements/src"))) {
    for (const m of readFileSync(f, "utf8").matchAll(/define\(\s*"([a-z][\w-]*)"\s*,\s*(\w+)\s*\)/g)) out.set(m[2]!, m[1]!);
  }
  return out;
}

function docText(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): string {
  if (!symbol) return "";
  return ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
}

function tag(symbol: ts.Symbol | undefined, name: string): string | undefined {
  const t = symbol?.getJsDocTags().find((x) => x.name === name);
  return t ? ts.displayPartsToString(t.text).trim() : undefined;
}

function source(node: ts.Node): string {
  const sf = node.getSourceFile();
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
  return `${relative(ROOT, sf.fileName)}:${line + 1}`;
}

function isPublic(m: ts.ClassElement): boolean {
  if (m.name && ts.isPrivateIdentifier(m.name)) return false;
  const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
  return !mods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword);
}

function isStatic(m: ts.ClassElement): boolean {
  const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
  return mods.some((x) => x.kind === ts.SyntaxKind.StaticKeyword);
}

function isReadonly(m: ts.ClassElement): boolean {
  const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
  return mods.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword);
}

/** The default an accessor reads: `get x() { return this.#x.value }` over `#x = this.prop(default)`. */
function accessorDefault(cls: ts.ClassLikeDeclaration, getter: ts.GetAccessorDeclaration): string | undefined {
  const body = getter.body?.statements[0];
  if (!body || !ts.isReturnStatement(body) || !body.expression) return undefined;
  let e: ts.Expression = body.expression;
  if (ts.isPropertyAccessExpression(e) && e.name.text === "value") e = e.expression;
  if (!ts.isPropertyAccessExpression(e) || !ts.isPrivateIdentifier(e.name)) return undefined;
  const field = cls.members.find((m): m is ts.PropertyDeclaration => ts.isPropertyDeclaration(m) && m.name.getText() === e.getText().slice(5));
  const init = field?.initializer;
  if (!init || !ts.isCallExpression(init) || !init.expression.getText().endsWith(".prop")) return undefined;
  return init.arguments[0]?.getText();
}

function signature(checker: ts.TypeChecker, decl: ts.SignatureDeclaration, symbol: ts.Symbol | undefined): Pick<Entry, "params" | "returns"> {
  const sig = checker.getSignatureFromDeclaration(decl);
  const paramDocs = new Map((symbol?.getJsDocTags() ?? []).filter((t) => t.name === "param").map((t) => {
    const text = ts.displayPartsToString(t.text).trim();
    const [name, ...rest] = text.split(/\s+/);
    return [name ?? "", rest.join(" ").replace(/^-\s*/, "")] as const;
  }));
  const params = decl.parameters.map((p): Param => ({
    name: p.name.getText(),
    type: checker.typeToString(checker.getTypeAtLocation(p), decl, ts.TypeFormatFlags.NoTruncation),
    optional: p.questionToken !== undefined || p.initializer !== undefined,
    description: paramDocs.get(p.name.getText()) ?? "",
  }));
  const ret = sig ? checker.typeToString(sig.getReturnType(), decl, ts.TypeFormatFlags.NoTruncation) : "void";
  return { params, ...(ret === "void" ? {} : { returns: { type: ret, description: tag(symbol, "returns") ?? "" } }) };
}

export function extract(): Entry[] {
  const program = ts.createProgram(
    PACKAGES.map((p) => join(ROOT, p.index)),
    { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noEmit: true, strict: true, skipLibCheck: true, lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], types: [], jsx: ts.JsxEmit.ReactJSX },
  );
  const checker = program.getTypeChecker();
  const tagOf = tags();
  const out: Entry[] = [];
  const seen = new Set<string>();
  const push = (e: Omit<Entry, "seeAlso" | "examples" | "groups">) => {
    if (seen.has(e.ref)) return;
    seen.add(e.ref);
    out.push({ ...e, seeAlso: [], examples: [], groups: [] });
  };

  for (const pkg of PACKAGES) {
    const sf = program.getSourceFile(join(ROOT, pkg.index));
    if (!sf) continue;
    const mod = checker.getSymbolAtLocation(sf);
    if (!mod) continue;
    for (const exported of checker.getExportsOfModule(mod)) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const decl = symbol.declarations?.[0];
      if (!decl) continue;
      const name = exported.name;
      const doc = docText(checker, symbol);
      const deprecated = tag(symbol, "deprecated");
      const base = { name, package: pkg.name, description: doc, source: source(decl), ...(deprecated !== undefined ? { deprecated } : {}) };
      switch (true) {
        case ts.isClassDeclaration(decl): {
          const cls = decl as ts.ClassDeclaration;
          const heritage = cls.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression.getText();
          const ref = `class:${name}`;
          push({ ...base, ref, kind: "class", ...(tagOf.has(name) ? { tag: tagOf.get(name)! } : {}), ...(heritage ? { inheritsFrom: heritage } : {}) });
          classMembers(checker, cls, ref, pkg.name, push);
          break;
        }
        case ts.isInterfaceDeclaration(decl): {
          const ref = `object:${name}`;
          push({ ...base, ref, kind: "object" });
          for (const m of (decl as ts.InterfaceDeclaration).members) {
            if (!m.name || !(ts.isPropertySignature(m) || ts.isMethodSignature(m))) continue;
            const ms = checker.getSymbolAtLocation(m.name);
            const mname = m.name.getText();
            const common = { name: mname, package: pkg.name, definingClass: ref, description: docText(checker, ms), source: source(m) };
            if (ts.isMethodSignature(m)) push({ ...common, ref: `method:${name}.${mname}`, kind: "method", ...signature(checker, m, ms) });
            else
              push({
                ...common,
                ref: `attr:${name}.${mname}`,
                kind: "attr",
                valueType: checker.typeToString(checker.getTypeAtLocation(m), m, ts.TypeFormatFlags.NoTruncation),
                flags: m.modifiers?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword) ? "R" : "RW",
                ...(tag(ms, "default") !== undefined ? { defaultValue: tag(ms, "default")! } : {}),
              });
          }
          break;
        }
        case ts.isTypeAliasDeclaration(decl):
          push({ ...base, ref: `type:${name}`, kind: "type", valueType: (decl as ts.TypeAliasDeclaration).type.getText() });
          break;
        case ts.isFunctionDeclaration(decl):
          push({ ...base, ref: `staticMethod:${name}`, kind: "staticMethod", ...signature(checker, decl as ts.FunctionDeclaration, symbol) });
          break;
        case ts.isVariableDeclaration(decl): {
          const type = checker.getTypeAtLocation(decl);
          const constructor = type.getConstructSignatures()[0];
          const contract = type.getProperty("contract");
          if (constructor && contract) {
            const ref = `class:${name}`;
            const init = (decl as ts.VariableDeclaration).initializer;
            let elementTag: string | undefined;
            if (init && ts.isCallExpression(init)) {
              const first = init.arguments[0];
              if (first && ts.isStringLiteral(first)) elementTag = first.text;
              if (first && ts.isObjectLiteralExpression(first)) {
                const prop = first.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText() === "tag");
                if (prop && ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer)) elementTag = prop.initializer.text;
              }
            }
            push({ ...base, ref, kind: "class", inheritsFrom: "AsterElement", ...(elementTag ? { tag: elementTag } : {}) });
            const instance = constructor.getReturnType();
            for (const property of checker.getTypeOfSymbolAtLocation(contract, decl).getProperties()) {
              const member = instance.getProperty(property.name);
              if (!member) continue;
              push({ name: property.name, package: pkg.name, ref: `attr:${name}.${property.name}`, kind: "attr", definingClass: ref,
                description: docText(checker, member), source: source(property.declarations?.[0] ?? decl), flags: "RW",
                valueType: checker.typeToString(checker.getTypeOfSymbolAtLocation(member, decl), decl, ts.TypeFormatFlags.NoTruncation) });
            }
          }
          // Retain constant references used by existing documentation links.
          push({ ...base, ref: `constant:${name}`, kind: "constant", valueType: checker.typeToString(checker.getTypeAtLocation(decl), decl, ts.TypeFormatFlags.NoTruncation) });
          break;
        }
      }
    }
  }
  return out;
}

function classMembers(checker: ts.TypeChecker, cls: ts.ClassDeclaration, owner: string, pkg: string, push: (e: Omit<Entry, "seeAlso" | "examples" | "groups">) => void): void {
  const name = owner.slice("class:".length);
  const accessors = new Map<string, { get?: ts.GetAccessorDeclaration; set?: ts.SetAccessorDeclaration }>();
  for (const m of cls.members) {
    if (!m.name || !isPublic(m)) continue;
    const mname = m.name.getText();
    if (LIFECYCLE.has(mname) || mname.startsWith("_")) continue;
    const ms = checker.getSymbolAtLocation(m.name);
    const common = { name: mname, package: pkg, definingClass: owner, description: docText(checker, ms), source: source(m) };
    const stat = isStatic(m);
    switch (true) {
      case ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m): {
        const pair = accessors.get(mname) ?? {};
        if (ts.isGetAccessorDeclaration(m)) pair.get = m;
        else pair.set = m as ts.SetAccessorDeclaration;
        accessors.set(mname, pair);
        break;
      }
      case ts.isMethodDeclaration(m):
        push({ ...common, ref: `${stat ? "classMethod" : "method"}:${name}.${mname}`, kind: stat ? "classMethod" : "method", ...signature(checker, m as ts.MethodDeclaration, ms) });
        break;
      case ts.isPropertyDeclaration(m): {
        const p = m as ts.PropertyDeclaration;
        push({
          ...common,
          ref: `${stat ? "classAttr" : "attr"}:${name}.${mname}`,
          kind: stat ? "classAttr" : "attr",
          valueType: checker.typeToString(checker.getTypeAtLocation(p), p, ts.TypeFormatFlags.NoTruncation),
          flags: isReadonly(p) ? "R" : "RW",
          ...(p.initializer && !ts.isCallExpression(p.initializer) && !ts.isNewExpression(p.initializer) ? { defaultValue: p.initializer.getText() } : {}),
        });
        break;
      }
    }
  }
  for (const [mname, { get, set }] of accessors) {
    const decl = get ?? set!;
    const ms = checker.getSymbolAtLocation(decl.name);
    const def = get ? accessorDefault(cls, get) : undefined;
    push({
      name: mname,
      package: pkg,
      definingClass: owner,
      description: docText(checker, ms),
      source: source(decl),
      ref: `attr:${name}.${mname}`,
      kind: "attr",
      valueType: checker.typeToString(checker.getTypeAtLocation(decl), decl, ts.TypeFormatFlags.NoTruncation),
      flags: set ? "RW" : "R",
      ...(def !== undefined ? { defaultValue: def } : {}),
    });
  }
  // Events: `this.emit("name", ...)` anywhere in the class body.
  const events = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText() === "this.emit" && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) events.add(n.arguments[0].text);
    n.forEachChild(visit);
  };
  visit(cls);
  for (const ev of events) push({ name: ev, package: pkg, definingClass: owner, description: "", source: source(cls), ref: `event:${name}.${ev}`, kind: "event" });
}

if (import.meta.main) {
  const entries = extract();
  const byKind = new Map<string, number>();
  for (const e of entries) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  console.log(entries.length, Object.fromEntries(byKind));
  console.log(`described in code: ${entries.filter((e) => e.description).length}`);
}
