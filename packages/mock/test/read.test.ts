import { expect, test } from "bun:test";
import { get, json, service } from "./helpers.ts";

test("the seed reproduces the mockup's projects", async () => {
  const s = await service();
  const r = await get(s, "Projects?$filter=id le 5&$orderby=id&$expand=lead($select=name)");
  expect(r.status).toBe(200);
  const rows = json(r).value;
  expect(rows.map((p: { name: string }) => p.name)).toEqual([
    "Spring launch",
    "Brand refresh",
    "Billing v2",
    "Onboarding emails",
    "Help centre migration",
  ]);
  expect(rows[1].behindDays).toBe(3);
  expect(rows[1].lead.name).toBe("Grace Hopper");
  const open: number[] = [];
  for (let id = 1; id <= 5; id++) {
    const c = await get(s, `Tasks/$count?$filter=projectId eq ${id} and parentId eq null and done eq false`);
    open.push(Number(c.body));
  }
  expect(open).toEqual([23, 41, 17, 9, 58]);
});

test("$filter, $orderby, $top and $count", async () => {
  const s = await service();
  const r = json(
    await get(
      s,
      "Projects?$filter=state eq 'active' and pinned eq true&$orderby=name desc&$count=true&$top=2",
    ),
  );
  expect(r["@odata.count"]).toBe(3);
  expect(r.value.map((p: { name: string }) => p.name)).toEqual(["Spring launch", "Brand refresh"]);
  expect(r.value[0]["@odata.etag"]).toMatch(/^W\/"[0-9a-f]{16}"$/);

  const week = json(
    await get(s, "Tasks?$filter=due ge 2026-10-05 and due le 2026-10-11 and done eq false and parentId eq null&$orderby=due,id"),
  );
  const titles = week.value.map((t: { title: string }) => t.title);
  expect(titles).toContain("Final logo files to print");
  expect(titles).toContain("Launch email, second draft");
  expect(titles).toContain("Proration rules sign-off");

  const decimals = json(await get(s, "Projects?$filter=budget gt 100000.00&$count=true&$top=0"));
  expect(decimals["@odata.count"]).toBeGreaterThan(0);
});

test("server-driven paging follows next links", async () => {
  const s = await service({ maxPageSize: 50 });
  let url: string | undefined = "Projects?$orderby=id";
  let total = 0;
  let pages = 0;
  while (url) {
    const r = json(await get(s, url));
    total += r.value.length;
    pages++;
    url = r["@odata.nextLink"]?.replace("http://localhost/odata/", "");
  }
  expect(total).toBe(200);
  expect(pages).toBe(4);
});

test("$metadata and the service document", async () => {
  const s = await service();
  const m = await get(s, "$metadata");
  expect(m.headers["content-type"]).toBe("application/json");
  expect(json(m).$EntityContainer).toBe("AsterDemo.Container");
  expect(json(await get(s, "")).value.map((e: { name: string }) => e.name)).toContain("Projects");
});

test("the pinned note, members and share link", async () => {
  const s = await service();
  const note = json(await get(s, "Notes?$filter=pinned eq true&$expand=author($select=name)")).value[0];
  expect(note.author.name).toBe("Ada Lovelace");
  expect(note.body).toStartWith("Brand refresh slips unless");
  const members = json(await get(s, "Members?$orderby=id")).value;
  expect(members.map((m: { role: string }) => m.role)).toEqual(["owner", "edit", "view"]);
  const links = json(await get(s, "ShareLinks")).value;
  expect(links).toHaveLength(1);
  expect(links[0].url).toBe("aster.example/p/7f3k");
});

test("now() in a query reads the mock's clock", async () => {
  const count = async (at: string) => {
    const s = await service({ now: () => at });
    return Number((await get(s, "Projects/$count?$filter=updatedAt lt now()")).body);
  };
  expect(await count("2000-01-01T00:00:00Z")).toBe(0);
  expect(await count("2030-01-01T00:00:00Z")).toBeGreaterThan(0);
});
