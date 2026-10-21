import type {
  AllowedValue,
  Annotations,
  EdmType,
  EntitySet,
  EntityType,
  Field,
  Navigation,
  Schema,
  Skipped,
  Value,
} from "./model.ts";

/** A metadata problem, with the JSON path of the offending member. */
export class SchemaError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.name = "SchemaError";
    this.path = path;
  }
}

const EDM_TYPES: ReadonlySet<string> = new Set<EdmType>([
  "Edm.String",
  "Edm.Boolean",
  "Edm.Byte",
  "Edm.SByte",
  "Edm.Int16",
  "Edm.Int32",
  "Edm.Int64",
  "Edm.Single",
  "Edm.Double",
  "Edm.Decimal",
  "Edm.Date",
  "Edm.TimeOfDay",
  "Edm.DateTimeOffset",
  "Edm.Duration",
  "Edm.Guid",
  "Edm.Binary",
]);

type Json = Record<string, unknown>;

class FrozenMap<K, V> extends Map<K, V> {
  #sealed = false;
  seal(): this {
    this.#sealed = true;
    return this;
  }
  override set(key: K, value: V): this {
    if (this.#sealed) throw new TypeError("schema is immutable");
    return super.set(key, value);
  }
  override delete(_key: K): boolean {
    throw new TypeError("schema is immutable");
  }
  override clear(): void {
    throw new TypeError("schema is immutable");
  }
}

class FrozenSet<T> extends Set<T> {
  #sealed = false;
  seal(): this {
    this.#sealed = true;
    return this;
  }
  override add(value: T): this {
    if (this.#sealed) throw new TypeError("schema is immutable");
    return super.add(value);
  }
  override delete(_value: T): boolean {
    throw new TypeError("schema is immutable");
  }
  override clear(): void {
    throw new TypeError("schema is immutable");
  }
}

function frozenSet(items: readonly string[]): ReadonlySet<string> {
  const s = new FrozenSet<string>();
  for (const i of items) s.add(i);
  return s.seal();
}

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function obj(v: unknown, path: string): Json {
  if (!isObject(v)) throw new SchemaError("expected an object", path);
  return v;
}

function optBool(o: Json, key: string, path: string): boolean | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new SchemaError("expected a boolean", `${path}/${key}`);
  return v;
}

function optInt(o: Json, key: string, path: string): number | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new SchemaError("expected a non-negative integer", `${path}/${key}`);
  }
  return v;
}

/** Maps a vocabulary namespace or alias to the alias it is known by here. */
function namespaceResolver(root: Json): (ns: string) => string {
  const map = new Map<string, string>();
  const refs = root["$Reference"];
  if (refs !== undefined) {
    for (const [uri, ref] of Object.entries(obj(refs, "/$Reference"))) {
      const includes = obj(ref, `/$Reference/${uri}`)["$Include"];
      if (includes === undefined) continue;
      if (!Array.isArray(includes)) {
        throw new SchemaError("expected an array", `/$Reference/${uri}/$Include`);
      }
      includes.forEach((inc, i) => {
        const p = `/$Reference/${uri}/$Include/${i}`;
        const o = obj(inc, p);
        const ns = o["$Namespace"];
        if (typeof ns !== "string") throw new SchemaError("expected a string", `${p}/$Namespace`);
        const alias = typeof o["$Alias"] === "string" ? o["$Alias"] : ns;
        map.set(ns, alias);
        map.set(alias, alias);
      });
    }
  }
  return (ns) => map.get(ns) ?? ns;
}

/** `@Org.OData.Core.V1.Description#q` becomes `Core.Description#q`; `@A@B` chains. */
function annotationKey(raw: string, resolve: (ns: string) => string): string {
  return raw
    .split("@")
    .filter((s) => s !== "")
    .map((seg) => {
      const hash = seg.indexOf("#");
      const term = hash < 0 ? seg : seg.slice(0, hash);
      const qualifier = hash < 0 ? "" : seg.slice(hash);
      const dot = term.lastIndexOf(".");
      if (dot < 0) return seg;
      return `${resolve(term.slice(0, dot))}${term.slice(dot)}${qualifier}`;
    })
    .join("@");
}

function annotationsOf(o: Json, resolve: (ns: string) => string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith("@")) out[annotationKey(k, resolve)] = v;
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function toValue(v: unknown, path: string): Value {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  throw new SchemaError("expected a primitive value", path);
}

function propertyPaths(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") out.push(item);
    else if (isObject(item) && typeof item["$PropertyPath"] === "string") {
      out.push(item["$PropertyPath"]);
    }
  }
  return out;
}

interface NavDraft {
  readonly typeName: string;
  readonly name: string;
  readonly path: string;
  readonly raw: Json;
  readonly targetType: string;
}

interface TypeDraft {
  /** Qualified by namespace, never by alias. */
  readonly qualified: string;
  readonly name: string;
  readonly namespace: string;
  readonly path: string;
  readonly json: Json;
}

/**
 * Parses a CSDL JSON 4.01 `$metadata` document. Throws `SchemaError` when
 * the document is malformed; a property it can't model (a stream, an
 * untyped or complex value, a collection) is left out and listed in
 * `skipped`, and the rest of the schema stands.
 */
export function parseCsdl(json: unknown): Schema {
  const root = obj(json, "");
  const resolve = namespaceResolver(root);
  const skipped: Skipped[] = [];

  const namespaces = Object.keys(root).filter((k) => !k.startsWith("$") && !k.startsWith("@"));
  if (namespaces.length === 0) throw new SchemaError("no schema namespace", "");
  /** Alias or namespace to namespace. */
  const byAlias = new Map<string, string>();
  for (const ns of namespaces) {
    byAlias.set(ns, ns);
    const alias = str(obj(root[ns], `/${ns}`)["$Alias"]);
    if (alias !== undefined) byAlias.set(alias, ns);
  }
  const qualify = (name: string, path: string): string => {
    const dot = name.lastIndexOf(".");
    const ns = dot < 0 ? undefined : byAlias.get(name.slice(0, dot));
    if (ns === undefined) throw new SchemaError(`type '${name}' is not in this document`, path);
    return `${ns}.${name.slice(dot + 1)}`;
  };

  const containerRef = root["$EntityContainer"];
  if (typeof containerRef !== "string") {
    throw new SchemaError("missing $EntityContainer", "/$EntityContainer");
  }
  const containerQualified = qualify(containerRef, "/$EntityContainer");
  const namespace = containerQualified.slice(0, containerQualified.lastIndexOf("."));
  const containerName = containerQualified.slice(namespace.length + 1);

  const typeDrafts = new Map<string, TypeDraft>();
  let containerJson: Json | undefined;
  for (const ns of namespaces) {
    for (const [name, member] of Object.entries(obj(root[ns], `/${ns}`))) {
      if (name.startsWith("$") || name.startsWith("@")) continue;
      const p = `/${ns}/${name}`;
      const o = obj(member, p);
      if (o["$Kind"] === "EntityType") typeDrafts.set(`${ns}.${name}`, { qualified: `${ns}.${name}`, name, namespace: ns, path: p, json: o });
      else if (o["$Kind"] === "EntityContainer" && ns === namespace && name === containerName) containerJson = o;
    }
  }
  if (!containerJson) {
    throw new SchemaError(`entity container '${containerRef}' not found`, "/$EntityContainer");
  }

  /** A type's own members, then its base type's: a derived type has every property its base has. */
  const chain = (draft: TypeDraft): TypeDraft[] => {
    const out: TypeDraft[] = [];
    for (let d: TypeDraft | undefined = draft; d; ) {
      if (out.includes(d)) throw new SchemaError("$BaseType cycle", `${draft.path}/$BaseType`);
      out.push(d);
      const base = d.json["$BaseType"];
      if (base === undefined) break;
      if (typeof base !== "string") throw new SchemaError("expected a string", `${d.path}/$BaseType`);
      const next = typeDrafts.get(qualify(base, `${d.path}/$BaseType`));
      if (!next) throw new SchemaError(`unknown base type '${base}'`, `${d.path}/$BaseType`);
      d = next;
    }
    return out;
  };

  const fieldsByType = new Map<string, Field[]>();
  const keysByType = new Map<string, readonly string[]>();
  const navsDraftByType = new Map<string, NavDraft[]>();
  const typeAnnotations = new Map<string, Record<string, unknown>>();

  for (const [qualified, draft] of typeDrafts) {
    const fields: Field[] = [];
    const navs: NavDraft[] = [];
    let rawKey: unknown;
    let keyPath = "";
    const annotations: Record<string, unknown> = {};
    for (const d of chain(draft).reverse()) {
      Object.assign(annotations, annotationsOf(d.json, resolve));
      if (d.json["$Key"] !== undefined) [rawKey, keyPath] = [d.json["$Key"], `${d.path}/$Key`];
      for (const [name, member] of Object.entries(d.json)) {
        if (name.startsWith("$") || name.startsWith("@")) continue;
        const p = `${d.path}/${name}`;
        const o = obj(member, p);
        if (o["$Kind"] === "NavigationProperty") {
          const t = o["$Type"];
          if (typeof t !== "string") throw new SchemaError("missing $Type", `${p}/$Type`);
          navs.push({ typeName: qualified, name, path: p, raw: o, targetType: qualify(t, `${p}/$Type`) });
          continue;
        }
        const reason = unmodelled(o);
        if (reason) skipped.push({ path: p, reason });
        else fields.push(parseField(name, o, p, resolve));
      }
    }

    let key: string[] = [];
    if (rawKey !== undefined) {
      if (!Array.isArray(rawKey)) throw new SchemaError("expected an array", keyPath);
      key = rawKey.map((k, i) => {
        if (typeof k !== "string") {
          throw new SchemaError("only simple key property names are supported", `${keyPath}/${i}`);
        }
        if (!fields.some((f) => f.name === k)) {
          throw new SchemaError(`key property '${k}' is not a property`, `${keyPath}/${i}`);
        }
        return k;
      });
    }
    fieldsByType.set(qualified, fields);
    keysByType.set(qualified, key);
    navsDraftByType.set(qualified, navs);
    typeAnnotations.set(qualified, annotations);
  }

  // Entity sets and their navigation bindings.
  interface SetDraft {
    name: string;
    typeName: string;
    path: string;
    raw: Json;
    bindings: Map<string, string>;
    annotations: Record<string, unknown>;
  }
  const setDrafts: SetDraft[] = [];
  for (const [name, member] of Object.entries(containerJson)) {
    if (name.startsWith("$") || name.startsWith("@")) continue;
    const p = `/${namespace}/${containerName}/${name}`;
    const o = obj(member, p);
    if (o["$Collection"] !== true || typeof o["$Type"] !== "string") continue;
    const typeName = qualify(o["$Type"], `${p}/$Type`);
    if (!typeDrafts.has(typeName)) {
      throw new SchemaError(`unknown entity type '${o["$Type"]}'`, `${p}/$Type`);
    }
    const bindings = new Map<string, string>();
    const b = o["$NavigationPropertyBinding"];
    if (b !== undefined) {
      for (const [navPath, target] of Object.entries(obj(b, `${p}/$NavigationPropertyBinding`))) {
        if (typeof target !== "string") {
          throw new SchemaError(
            "expected a string",
            `${p}/$NavigationPropertyBinding/${navPath}`,
          );
        }
        bindings.set(navPath, target);
      }
    }
    setDrafts.push({
      name,
      typeName,
      path: p,
      raw: o,
      bindings,
      annotations: annotationsOf(o, resolve),
    });
  }
  const setNames = new Set(setDrafts.map((s) => s.name));

  // Pass 2: navigations.
  const navsByType = new Map<string, Navigation[]>();
  for (const [qualified, navDrafts] of navsDraftByType) {
    const list: Navigation[] = [];
    for (const nd of navDrafts) {
      const o = nd.raw;
      const collection = o["$Collection"] === true;
      const targetDraft = typeDrafts.get(nd.targetType);
      if (!targetDraft) {
        throw new SchemaError(`unknown entity type '${nd.targetType}'`, `${nd.path}/$Type`);
      }

      let target: string | undefined;
      for (const s of setDrafts) {
        if (s.typeName !== nd.typeName) continue;
        const t = s.bindings.get(nd.name);
        if (t === undefined) continue;
        if (!setNames.has(t)) {
          throw new SchemaError(
            `binding targets unknown entity set '${t}'`,
            `${s.path}/$NavigationPropertyBinding/${nd.name}`,
          );
        }
        target = t;
        break;
      }
      if (target === undefined) {
        const candidates = setDrafts.filter((s) => s.typeName === nd.targetType);
        if (candidates.length > 1) {
          throw new SchemaError(
            "no navigation binding and several entity sets of the target type",
            nd.path,
          );
        }
        // Contained targets have no set of their own.
        target = candidates[0]?.name ?? targetDraft.name;
      }

      const own = constraintPairs(o["$ReferentialConstraint"], `${nd.path}/$ReferentialConstraint`);
      let keys: [string, string][] = own;
      const partner = str(o["$Partner"]);
      if (own.length === 0 && collection && partner !== undefined) {
        const partnerJson = chain(targetDraft).map((d) => d.json[partner]).find(isObject);
        if (partnerJson) {
          keys = constraintPairs(
            partnerJson["$ReferentialConstraint"],
            `${targetDraft.path}/${partner}/$ReferentialConstraint`,
          ).map(([dependent, principal]) => [principal, dependent]);
        }
      }

      const nav: Navigation = {
        name: nd.name,
        target,
        collection,
        keys: keys.map((k) => Object.freeze(k)),
        ...(partner !== undefined ? { partner } : {}),
        owned: annotationsOf(o, resolve)["AsterData.Owned"] === true,
      };
      list.push(Object.freeze(nav));
    }
    navsByType.set(qualified, list);
  }

  const types = new FrozenMap<string, EntityType>();
  for (const [qualified, draft] of typeDrafts) {
    const fields = Object.freeze(fieldsByType.get(qualified)!);
    const navigations = Object.freeze(navsByType.get(qualified)!);
    const fieldMap = new Map(fields.map((f) => [f.name, f]));
    const navMap = new Map(navigations.map((n) => [n.name, n]));
    const ann = typeAnnotations.get(qualified)!;
    const title = str(ann["Core.Description"]);
    const pluralTitle = str(ann["AsterData.PluralTitle"]);
    const titleField = str(ann["AsterData.TitleField"]);
    const type: EntityType = {
      name: draft.name,
      qualifiedName: qualified,
      key: Object.freeze([...keysByType.get(qualified)!]),
      fields,
      navigations,
      ...(title !== undefined ? { title } : {}),
      ...(pluralTitle !== undefined ? { pluralTitle } : {}),
      ...(titleField !== undefined ? { titleField } : {}),
      annotations: Object.freeze(ann),
      field: (n) => fieldMap.get(n),
      navigation: (n) => navMap.get(n),
    };
    types.set(qualified, Object.freeze(type));
  }

  const sets = new FrozenMap<string, EntitySet>();
  for (const sd of setDrafts) {
    const type = types.get(sd.typeName)!;
    const oc = sd.annotations["Core.OptimisticConcurrency"];
    const filterable = recordMember(sd.annotations, "Capabilities.FilterRestrictions", "NonFilterableProperties");
    const sortable = recordMember(sd.annotations, "Capabilities.SortRestrictions", "NonSortableProperties");
    const t = sd.annotations["AsterData.CountThreshold"];
    const threshold = typeof t === "number" || typeof t === "string" ? Number(t) : Number.NaN;
    sets.set(
      sd.name,
      Object.freeze({
        name: sd.name,
        type,
        etag: Array.isArray(oc),
        nonFilterable: frozenSet(propertyPaths(filterable)),
        nonSortable: frozenSet(propertyPaths(sortable)),
        ...(Number.isFinite(threshold) && threshold >= 0 ? { countThreshold: threshold } : {}),
        annotations: Object.freeze(sd.annotations),
      }),
    );
  }
  types.seal();
  sets.seal();

  return Object.freeze({
    namespace,
    sets,
    types,
    skipped: Object.freeze(skipped),
    set(name: string): EntitySet {
      const s = sets.get(name);
      if (!s) throw new SchemaError(`no entity set '${name}'`, `/${containerName}`);
      return s;
    },
  });
}

/** Why a property can't be modelled here, or undefined if it can. */
function unmodelled(o: Json): string | undefined {
  const type = o["$Type"] ?? "Edm.String";
  if (o["$Collection"] === true) return "a collection-valued property";
  if (typeof type !== "string") return "a property without a type name";
  switch (type) {
    case "Edm.Stream":
      return "a stream";
    case "Edm.Untyped":
      return "an untyped value";
    default:
      return EDM_TYPES.has(type) ? undefined : `type ${type}`;
  }
}

/** A member of a record-valued annotation, or the flattened `Term.Member` key. */
function recordMember(ann: Annotations, term: string, member: string): unknown {
  const rec = ann[term];
  if (isObject(rec) && rec[member] !== undefined) return rec[member];
  return ann[`${term}.${member}`];
}

function constraintPairs(v: unknown, path: string): [string, string][] {
  if (v === undefined) return [];
  const o = obj(v, path);
  return Object.entries(o).map(([dependent, principal]) => {
    if (typeof principal !== "string") throw new SchemaError("expected a string", `${path}/${dependent}`);
    return [dependent, principal];
  });
}

function parseField(
  name: string,
  o: Json,
  path: string,
  resolve: (ns: string) => string,
): Field {
  const type = o["$Type"] ?? "Edm.String";
  const ann = annotationsOf(o, resolve);
  const maxLength = optInt(o, "$MaxLength", path);
  const precision = optInt(o, "$Precision", path);
  const scale = optInt(o, "$Scale", path);

  const title = str(ann["Core.Description"]);
  const prompt = str(ann["Core.LongDescription"]);
  const pattern = str(ann["Validation.Pattern"]);
  const minLength = num(ann["AsterData.MinLength"]);

  let allowedValues: AllowedValue[] | undefined;
  const av = ann["Validation.AllowedValues"];
  if (av !== undefined) {
    const ap = `${path}/@Validation.AllowedValues`;
    if (!Array.isArray(av)) throw new SchemaError("expected an array", ap);
    allowedValues = av.map((item, i) => {
      const io = obj(item, `${ap}/${i}`);
      const label = str(annotationsOf(io, resolve)["Core.Description"]);
      return Object.freeze({
        value: toValue(io["Value"], `${ap}/${i}/Value`),
        ...(label !== undefined ? { label } : {}),
      });
    });
  }

  const bound = (v: unknown, term: string): number | string | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== "number" && typeof v !== "string") {
      throw new SchemaError("expected a number or string", `${path}/@${term}`);
    }
    return v;
  };
  const minimum = bound(ann["Validation.Minimum"], "Validation.Minimum");
  const maximum = bound(ann["Validation.Maximum"], "Validation.Maximum");
  const exMin = ann["Validation.Minimum@Validation.Exclusive"];
  const exMax = ann["Validation.Maximum@Validation.Exclusive"];
  const defaultValue = o["$DefaultValue"] === undefined ? undefined : toValue(o["$DefaultValue"], `${path}/$DefaultValue`);
  const rootValue = ann["AsterData.RootValue"] === undefined ? undefined : toValue(ann["AsterData.RootValue"], `${path}/@AsterData.RootValue`);

  return Object.freeze({
    name,
    type: type as EdmType,
    nullable: optBool(o, "$Nullable", path) ?? false,
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(precision !== undefined ? { precision } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    computed: ann["Core.Computed"] === true,
    immutable: ann["Core.Immutable"] === true,
    ...(allowedValues !== undefined ? { allowedValues: Object.freeze(allowedValues) } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    ...(exMin === true ? { exclusiveMinimum: true } : {}),
    ...(exMax === true ? { exclusiveMaximum: true } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(ann["AsterData.EmptyAsNull"] === true ? { emptyAsNull: true } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(rootValue !== undefined ? { rootValue } : {}),
    annotations: Object.freeze(ann),
  });
}
