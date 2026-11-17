import { parseCsdl } from "../../src/schema/csdl.ts";
import { matches, sortComparator } from "../../src/criteria/evaluate.ts";
import type { Entity } from "../../src/schema/model.ts";
import type { ODataRequest, ODataResponse, Transport } from "../../src/transport.ts";

const string = { $Type: "Edm.String" };
const nav = (type: string, collection = true) => ({ $Kind: "NavigationProperty", $Type: `Read.${type}`, $Collection: collection });
/** Stream-owned protocol fixture: deliberately has no referential constraints. */
export const navigatorMetadata = {
  $Version: "4.01", $EntityContainer: "Read.Container",
  Read: {
    Root: { $Kind: "EntityType", $Key: ["tenant", "id"], tenant: string, id: string, title: string, readings: nav("Child"), meetings: nav("Child"), related: nav("Root"), owner: nav("Person", false) },
    Child: { $Kind: "EntityType", $Key: ["tenant", "id"], tenant: string, id: string, title: string, people: nav("Person") },
    Person: { $Kind: "EntityType", $Key: ["id"], id: string, name: string, secret: string },
    Container: { $Kind: "EntityContainer",
      Roots: { $Collection: true, $Type: "Read.Root", $NavigationPropertyBinding: { readings: "Children", meetings: "Children", related: "Roots", owner: "People" } },
      Children: { $Collection: true, $Type: "Read.Child", $NavigationPropertyBinding: { people: "People" } },
      People: { $Collection: true, $Type: "Read.Person" },
    },
  },
};

export const navigatorSchema = parseCsdl(navigatorMetadata);
export const rootKey = (index: number): string => JSON.stringify(["O'Brien/UK", String(index)]);
export const rootIdentity = (index: number) => ({ set: "Roots", key: rootKey(index) });
export const childIdentity = (index: number, child: number) => ({ set: "Children", key: JSON.stringify([String(index), String(child)]) });
export const response = (body: unknown, status = 200): ODataResponse => ({ status, headers: {}, body: JSON.stringify(body) });

export class NavigatorTransport {
  readonly requests: ODataRequest[] = [];
  bytes = 0;
  /** Fail once per selected root/relationship. */
  fail: string | undefined;
  before: ((request: ODataRequest) => Promise<void>) | undefined;
  readonly roots: Entity[];
  readonly transport: Transport;

  constructor(readonly lengths: readonly number[] = [3, 0, 7]) {
    this.roots = lengths.map((_, i) => ({ tenant: "O'Brien/UK", id: String(i), title: `Root ${i}` }));
    this.transport = async (request) => {
      this.requests.push(request);
      await this.before?.(request);
      const result = this.answer(request);
      this.bytes += new TextEncoder().encode(result.body).length;
      return result;
    };
  }

  answer(request: ODataRequest): ODataResponse {
    if (request.url === "$metadata") return response(navigatorMetadata);
    const [encoded, query = ""] = request.url.split("?");
    const path = decodeURIComponent(encoded!);
    const params = new URLSearchParams(query);
    const root = /^Roots\(tenant='O''Brien\/UK',id='(\d+)'\)\/(\w+)$/.exec(path);
    const child = /^Children\(tenant='(\d+)',id='(\d+)'\)\/people$/.exec(path);
    let values: Entity[];
    if (path === "Roots") values = this.roots;
    else if (root) {
      const i = Number(root[1]);
      const relation = root[2];
      if (this.fail === `${i}/${relation}`) { this.fail = undefined; return response({ error: { code: "fixture", message: "retry this child" } }, 503); }
      switch (relation) {
        case "owner": return i === 1 ? response(null) : response({ id: "shared", name: "Ada", secret: null, "@odata.etag": 'W/"1"', "@AsterData.Hidden": ["secret"] });
        case "related": values = [this.roots[i]!]; break;
        case "readings": values = Array.from({ length: this.lengths[i] ?? 0 }, (_, n) => ({ tenant: String(i), id: String(n), title: `Reading ${n}` })); break;
        case "meetings": values = Array.from({ length: i === 1 ? 2 : 1 }, (_, n) => ({ tenant: String(i), id: String(10000 + n), title: `Meeting ${n}` })); break;
        default: return response({ error: { message: `unknown relationship ${path}` } }, 404);
      }
    } else if (child) values = [{ id: "shared", name: "Ada", secret: null, "@odata.etag": 'W/"1"', "@AsterData.Hidden": ["secret"] } as unknown as Entity];
    else return response({ error: { code: "route", message: `refused unaddressed read ${path}` } }, 400);
    const filter = params.get("$filter");
    if (filter) {
      const match = /^title eq '(.*)'$/.exec(filter);
      if (!match) throw new Error(`fixture cannot evaluate ${filter}`);
      values = values.filter((entity) => matches({ op: "eq", field: "title", value: match[1]!.replaceAll("''", "'") }, entity, navigatorSchema.set(path === "Roots" ? "Roots" : "Children").type));
    }
    const order = params.get("$orderby");
    if (order) values = [...values].sort(sortComparator(order.split(",").map((field) => ({ field: field.replace(/ desc$/, ""), descending: field.endsWith(" desc") })), navigatorSchema.set(path === "Roots" ? "Roots" : child ? "People" : "Children").type));
    const skip = Number(params.get("$skip") ?? 0), top = Number(params.get("$top") ?? values.length);
    const selected = params.get("$select")?.split(",");
    const page = values.slice(skip, skip + top).map((value) => selected ? Object.fromEntries(Object.entries(value).filter(([name]) => selected.includes(name) || name.includes("@"))) : value);
    return response({ value: page, ...(params.has("$count") ? { "@odata.count": values.length } : {}) });
  }
}
