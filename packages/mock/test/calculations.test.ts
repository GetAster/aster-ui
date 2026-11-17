import { expect, test } from "bun:test";
import { createMockService, type MockServiceOptions } from "../src/index.ts";
import { get, json } from "./helpers.ts";

const money = { $Type: "Edm.Decimal", $Precision: 14, $Scale: 2, $Nullable: true };
function metadata(policy: object | undefined = { Mode: "readers" }) {
  const calculations = policy ? { "@AsterData.RequestCalculations": policy } : {};
  return {
    $Version: "4.01", $EntityContainer: "T.Container",
    T: {
      Order: { $Kind: "EntityType", $Key: ["ID"], ID: { $Type: "Edm.Int32" },
        Lines: { $Kind: "NavigationProperty", $Type: "T.Line", $Collection: true, $Partner: "Order" } },
      Line: { $Kind: "EntityType", $Key: ["ID"], ID: { $Type: "Edm.Int32" }, OrderID: { $Type: "Edm.Int32" },
        Quantity: { $Type: "Edm.Int32" }, UnitPrice: money,
        Secret: { ...money, "@AsterData.ViewableWhen": { $Eq: [{ $Path: "ID" }, 1] } },
        Order: { $Kind: "NavigationProperty", $Type: "T.Order", $Partner: "Lines", $ReferentialConstraint: { OrderID: "ID" } } },
      Container: { $Kind: "EntityContainer",
        Orders: { $Collection: true, $Type: "T.Order", ...calculations, $NavigationPropertyBinding: { Lines: "Lines" } },
        Lines: { $Collection: true, $Type: "T.Line", ...calculations, $NavigationPropertyBinding: { Order: "Orders" } } },
    },
  };
}
const data = { Orders: [{ ID: 1 }, { ID: 2 }], Lines: [
  { ID: 1, OrderID: 1, Quantity: 3, UnitPrice: "12.50", Secret: "9.00" },
  { ID: 2, OrderID: 1, Quantity: 4, UnitPrice: "20.00", Secret: "8.00" },
  { ID: 3, OrderID: 2, Quantity: 2, UnitPrice: null, Secret: "7.00" },
] };
const service = (extra: Partial<MockServiceOptions> = {}) => createMockService({ metadata: metadata(), data, ...extra });
const accept = { Accept: "application/json;IEEE754Compatible=true" };
const compute = "Quantity mul UnitPrice as LineTotal";

test("packaged engine calculates exact Decimal, null, elapsed hours and pages after count/filter/order", async () => {
  const s = await service();
  const r = await get(s, `Lines?$compute=${compute}&$filter=LineTotal gt 20&$orderby=LineTotal desc&$top=1&$count=true&$select=ID,LineTotal`, accept);
  expect(r.status).toBe(200);
  expect(json(r)["@odata.count"]).toBe("2");
  expect(json(r).value[0]).toMatchObject({ ID: 2, LineTotal: "80.00", "LineTotal@odata.type": "#Decimal" });
  const all = json(await get(s, `Lines?$compute=${compute}&$orderby=ID&$select=LineTotal`, accept));
  expect(all.value.map((r: { LineTotal: unknown }) => r.LineTotal)).toEqual(["37.50", "80.00", null]);
  const hours = await get(s, "Lines(1)?$compute=totalseconds(2026-11-16T02:30:00Z sub 2026-11-16T00:00:00Z) div 3600 as Hours&$select=Hours", accept);
  expect(hours.status).toBe(200);
  expect(Number(json(hours).Hours)).toBe(2.5);
});

test("apply totals see every matching row and nested pages use a separate child summary", async () => {
  const s = await service();
  const summary = await get(s, `Lines?$apply=filter(OrderID eq 1)/compute(${compute})/aggregate(LineTotal with sum as Total)`, accept);
  expect(summary.status).toBe(200);
  expect(json(summary).value[0].Total).toBe("117.50");
  const r = await get(s, `Orders?$orderby=ID&$expand=Lines($compute=${compute};$filter=LineTotal gt 20;$orderby=LineTotal desc;$top=1;$count=true;$select=ID,LineTotal)`, accept);
  expect(r.status).toBe(200);
  expect(json(r).value[0]["Lines@odata.count"]).toBe("2");
  expect(json(r).value[0].Lines[0].LineTotal).toBe("80.00");
  expect(json(r).value[1].Lines).toEqual([]);
});

test("calculation policy remains disabled without annotation and role authority comes only from fixture", async () => {
  const url = `Lines?$compute=${compute}`;
  const disabledMetadata = metadata();
  delete (disabledMetadata.T.Container.Lines as Record<string, unknown>)["@AsterData.RequestCalculations"];
  (disabledMetadata.T.Container.Lines as Record<string, unknown>)["@Org.OData.Capabilities.V1.ComputeSupported"] = true;
  const disabled = await service({ metadata: disabledMetadata });
  expect((await get(disabled, "Lines")).status).toBe(200);
  expect((await get(disabled, url)).status).toBe(403);
  const restricted = metadata({ Mode: "roles", Roles: ["analyst"] });
  const anonymous = await service({ metadata: restricted });
  expect((await get(anonymous, url, { Authorization: "Bearer analyst", "X-Roles": "analyst" })).status).toBe(403);
  const wrong = await service({ metadata: restricted, principal: { subject: "user", roles: ["reader"] } });
  expect((await get(wrong, url)).status).toBe(403);
  const principal = { subject: "user", roles: ["analyst"] };
  const allowed = await service({ metadata: restricted, principal });
  principal.roles.length = 0;
  expect((await get(allowed, url)).status).toBe(200);
  await allowed.reset();
  expect((await get(allowed, url)).status).toBe(200);
});

test("ViewableWhen masks source values before request calculations", async () => {
  const s = await service();
  const r = await get(s, "Lines?$compute=Secret mul 2 as Doubled&$orderby=ID&$select=ID,Doubled", accept);
  expect(r.status).toBe(200);
  expect(json(r).value.map((r: { Doubled: unknown }) => r.Doubled)).toEqual(["18.00", null, null]);
});

test("invalid policy and principal fixtures fail initialization", async () => {
  for (const policy of [{ Mode: "unknown" }, { Mode: "roles", Roles: [] }, { Mode: "roles", Roles: [" analyst"] }]) {
    await expect(service({ metadata: metadata(policy) })).rejects.toThrow("RequestCalculations");
  }
  await expect(service({ principal: { subject: " " } })).rejects.toThrow("principal");
});

test("static field permissions reject hidden aliases and preserve readable and writable flags", async () => {
  for (const permission of ["Write", "None", "Read", "ReadWrite"]) {
    const m = metadata();
    (m.T.Line.UnitPrice as Record<string, unknown>)["@Core.Permissions"] = permission;
    const s = await service({ metadata: m });
    const r = await get(s, "Lines?$compute=UnitPrice as Renamed&$select=ID,Renamed", accept);
    expect(r.status).toBe(permission === "Write" || permission === "None" ? 403 : 200);
    const write = await s.transport({ method: "PATCH", url: "Lines(1)", headers: { "Content-Type": "application/json", "If-Match": "*" }, body: JSON.stringify({ UnitPrice: "1.00" }) });
    expect(write.status).toBe(permission === "Read" || permission === "None" ? 400 : 204);
    if (write.status === 400) expect(json(write).error.details[0].code).toBe("ReadOnly");
  }
});

test("static entity Readable false denies ordinary and calculation reads", async () => {
  const m = metadata();
  (m.T.Container.Lines as Record<string, unknown>)["@Org.OData.Capabilities.V1.ReadRestrictions"] = { Readable: false };
  const s = await service({ metadata: m });
  expect((await get(s, "Lines")).status).toBe(403);
  expect((await get(s, `Lines?$compute=${compute}`)).status).toBe(403);
});
