import type { Query } from "../criteria/ast.ts";
import { formatLiteral, toApply, toQueryString, type Aggregate } from "../criteria/compile.ts";
import type { Criteria, SortKey } from "../criteria/ast.ts";
import { parseCsdl } from "../schema/csdl.ts";
import type { Entity, Schema, Value } from "../schema/model.ts";
import type { KeyValues } from "../store/keys.ts";
import type { StoredRecord } from "../store/store.ts";
import type { Method, ODataRequest, ODataResponse, Transport } from "../transport.ts";
import { errorFromResponse } from "./errors.ts";

export interface Page {
  readonly records: readonly StoredRecord[];
  /** Present when the request asked for `$count` and the server gave one. */
  readonly count?: number;
  /** `count` is the server's estimate (`@AsterData.CountEstimated`), not exact. */
  readonly estimated?: boolean;
}

/** Instance annotations aster-odata writes (`Aster.Data.V1`, alias `AsterData`). */
const COUNT_ESTIMATED = ["@AsterData.CountEstimated", "@Aster.Data.V1.CountEstimated"];
const HIDDEN = ["@AsterData.Hidden", "@Aster.Data.V1.Hidden"];

const ACCEPT = "application/json;odata.metadata=minimal;IEEE754Compatible=true";

/** OData 4.01 over a transport. Every failure is an `ODataError`. */
export class ODataSource {
  readonly schema: Schema;
  readonly #transport: Transport;

  constructor(schema: Schema, transport: Transport) {
    this.schema = schema;
    this.#transport = transport;
  }

  static async connect(transport: Transport): Promise<ODataSource> {
    const res = await transport({ method: "GET", url: "$metadata", headers: { accept: "application/json" } });
    if (res.status !== 200) throw errorFromResponse(res.status, res.body);
    return new ODataSource(parseCsdl(JSON.parse(res.body)), transport);
  }

  /**
   * One range of a query's results. With `count`, the total too; `exact`
   * asks for an exact one (`Prefer: aster.count=exact`) where the server
   * would otherwise estimate it or leave it out.
   */
  async query(query: Query, range: { skip?: number; top?: number; count?: boolean; exact?: boolean } = {}): Promise<Page> {
    const options = [toQueryString(query, this.schema)];
    if (range.skip) options.push(`$skip=${range.skip}`);
    if (range.top !== undefined) options.push(`$top=${range.top}`);
    if (range.count) options.push("$count=true");
    const qs = options.filter(Boolean).join("&");
    const headers = range.count && range.exact ? { prefer: "aster.count=exact" } : undefined;
    let body = await this.#json("GET", qs ? `${query.set}?${qs}` : query.set, undefined, headers);
    const count = body["@odata.count"];
    const estimated = COUNT_ESTIMATED.some((a) => body[a] === true);
    const records: StoredRecord[] = [];
    for (;;) {
      const value = Array.isArray(body.value) ? (body.value as Record<string, unknown>[]) : [];
      records.push(...value.map(toRecord));
      const next = body["@odata.nextLink"];
      if (typeof next !== "string" || (range.top !== undefined && records.length >= range.top)) break;
      body = await this.#json("GET", relativeToRoot(next, query.set));
    }
    return {
      records: range.top === undefined ? records : records.slice(0, range.top),
      ...(count === undefined ? {} : { count: Number(count), ...(estimated ? { estimated } : {}) }),
    };
  }

  /**
   * Counts and aggregates over a set, grouped by `groupBy` (one row per
   * distinct combination) or over all of it. Rows hold the group values,
   * `count`, and each aggregate's alias.
   */
  async aggregate(
    set: string,
    request: {
      readonly filter?: Criteria;
      readonly groupBy?: readonly string[];
      readonly aggregates?: readonly Aggregate[];
      readonly orderBy?: readonly SortKey[];
    },
  ): Promise<Record<string, Value>[]> {
    const entitySet = this.schema.set(set);
    const apply = toApply(entitySet.type, request.filter, request.groupBy ?? [], request.aggregates ?? [], entitySet, this.schema);
    const order = request.orderBy?.length ? `&$orderby=${encodeURIComponent(request.orderBy.map((k) => `${k.field}${k.descending ? " desc" : ""}`).join(","))}` : "";
    let body = await this.#json("GET", `${set}?$apply=${encodeURIComponent(apply)}${order}`);
    const values: Record<string, unknown>[] = [];
    for (;;) {
      if (Array.isArray(body.value)) values.push(...body.value as Record<string, unknown>[]);
      const next = body["@odata.nextLink"];
      if (typeof next !== "string") break;
      body = await this.#json("GET", relativeToRoot(next, set));
    }
    return values.map((row) => {
      const out: Record<string, Value> = {};
      for (const [k, v] of Object.entries(row)) if (!k.includes("@")) out[k] = v as Value;
      return out;
    });
  }

  async get(set: string, key: KeyValues): Promise<StoredRecord> {
    return toRecord(await this.#json("GET", this.#entityUrl(set, key)));
  }

  async create(set: string, values: Entity): Promise<StoredRecord> {
    return toRecord(
      await this.#json("POST", set, JSON.stringify(values), { prefer: "return=representation" }),
    );
  }

  /**
   * PATCH with `If-Match`; returns the updated record. `deltas` carries
   * owned collections' changes as `<navigation>@delta`, so the record and
   * its children change in one request, all or nothing.
   */
  async update(set: string, key: KeyValues, changes: Entity, etag: string | undefined, deltas: Deltas = {}): Promise<StoredRecord> {
    const type = this.schema.set(set).type;
    const body: Record<string, unknown> = { ...changes };
    for (const [nav, entries] of Object.entries(deltas)) {
      const target = type.navigation(nav)?.target;
      if (!target) throw new Error(`${type.name} has no navigation ${nav}`);
      body[`${nav}@delta`] = entries.map((e) => this.#deltaEntry(target, e));
    }
    return toRecord(
      await this.#json("PATCH", this.#entityUrl(set, key), JSON.stringify(body), {
        prefer: "return=representation",
        ...ifMatch(etag),
      }),
    );
  }

  /** An entry of `@delta`: a removal by `@id`, or values with any children inserted under it. */
  #deltaEntry(set: string, entry: DeltaEntry): unknown {
    if ("removed" in entry) return { "@removed": { reason: "deleted" }, "@id": this.#entityUrl(set, entry.removed) };
    const type = this.schema.set(set).type;
    const out: Record<string, unknown> = { ...entry.values };
    for (const [nav, children] of Object.entries(entry.nested ?? {})) {
      const target = type.navigation(nav)?.target;
      if (!target) throw new Error(`${type.name} has no navigation ${nav}`);
      out[nav] = children.map((c) => this.#deltaEntry(target, c));
    }
    return out;
  }

  async delete(set: string, key: KeyValues, etag: string | undefined): Promise<void> {
    await this.#send("DELETE", this.#entityUrl(set, key), undefined, ifMatch(etag));
  }

  #entityUrl(set: string, key: KeyValues): string {
    const type = this.schema.set(set).type;
    const literal = (name: string, v: Value) => {
      const field = type.field(name);
      if (!field) throw new Error(`${type.name} has no key property ${name}`);
      return encodeURIComponent(formatLiteral(v, field));
    };
    const parts = type.key.map((name, i) => {
      const v = key[i];
      if (v === undefined) throw new Error(`missing key value for ${name}`);
      return type.key.length === 1 ? literal(name, v) : `${name}=${literal(name, v)}`;
    });
    return `${set}(${parts.join(",")})`;
  }

  async #json(
    method: Method,
    url: string,
    body?: string,
    headers?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const res = await this.#send(method, url, body, headers);
    const parsed = JSON.parse(res.body) as Record<string, unknown>;
    if (res.headers.etag && parsed["@odata.etag"] === undefined) parsed["@odata.etag"] = res.headers.etag;
    return parsed;
  }

  async #send(method: Method, url: string, body?: string, headers?: Record<string, string>): Promise<ODataResponse> {
    const request: ODataRequest = {
      method,
      url,
      headers: {
        accept: ACCEPT,
        ...(body === undefined ? {} : { "content-type": "application/json;IEEE754Compatible=true" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body }),
    };
    const res = await this.#transport(request);
    if (res.status >= 400) throw errorFromResponse(res.status, res.body, res.headers.etag);
    return res;
  }
}

/**
 * One change to an owned child in a deep update: its key and changed values,
 * a new child's values (with its own new children by navigation), or a
 * removal by key.
 */
export type DeltaEntry =
  | { readonly values: Entity; readonly nested?: Readonly<Record<string, readonly DeltaEntry[]>> }
  | { readonly removed: KeyValues };

/** Deep update changes by owned navigation. */
export type Deltas = Readonly<Record<string, readonly DeltaEntry[]>>;

/**
 * `If-Match` whenever an ETag is held, whatever `$metadata` declares. With
 * none on an ETag-bearing set, the server answers 428 rather than overwriting.
 */
function ifMatch(etag: string | undefined): Record<string, string> {
  return etag !== undefined ? { "if-match": etag } : {};
}

/** Next links are absolute; the transport takes URLs relative to the service root. */
function relativeToRoot(link: string, set: string): string {
  const at = link.lastIndexOf(`/${set}`);
  return at < 0 ? link : link.slice(at + 1);
}

/**
 * Splits control information (`@odata.*`) from the entity's properties.
 * `@AsterData.Hidden` lists the fields the caller may not see on this
 * record; they arrive as `null`.
 */
function toRecord(json: Record<string, unknown>): StoredRecord {
  const entity: Record<string, Value> = {};
  let etag: string | undefined;
  let hidden: ReadonlySet<string> | undefined;
  for (const [name, v] of Object.entries(json)) {
    if (name === "@odata.etag") etag = String(v);
    else if (HIDDEN.includes(name) && Array.isArray(v) && v.length > 0) hidden = new Set(v.map(String));
    else if (!name.includes("@")) entity[name] = v as Value;
  }
  return { entity, ...(etag === undefined ? {} : { etag }), ...(hidden ? { hidden } : {}) };
}
