import { describe, expect, test } from "bun:test";
import { parseCsdl } from "@getaster/data";
import { FieldSelectionModel } from "../src/field-selection/model.ts";
import { validateFieldSelectionChrome, validateFieldSelectionFields, validateFieldSelectionPolicy, validateFieldSelectionSource, validateFieldSelectionValue } from "../src/field-selection/config.ts";

const schema = parseCsdl({ $Version: "4.01", $EntityContainer: "F.Container", F: {
  Person: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, name: { "@Core.Description": "Full name" },
    email: {}, manager: { $Kind: "NavigationProperty", $Type: "F.Person" },
    tasks: { $Kind: "NavigationProperty", $Collection: true, $Type: "F.Task" } },
  Task: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, title: { "@Core.Description": "Task title" },
    owner: { $Kind: "NavigationProperty", $Type: "F.Person" } },
  Container: { $Kind: "EntityContainer", People: { $Collection: true, $Type: "F.Person", $NavigationPropertyBinding: { manager: "People", tasks: "Tasks" } },
    Tasks: { $Collection: true, $Type: "F.Task", $NavigationPropertyBinding: { owner: "People" } } },
} });

const create = () => new FieldSelectionModel({ schema, entitySet: "People" });

describe("field selection", () => {
  test("single hierarchy chrome validates independently of selection state", () => {
    expect(validateFieldSelectionChrome({})).toEqual({});
    expect(validateFieldSelectionChrome({ selected: false })).toEqual({ selected: false });
    expect(Object.isFrozen(validateFieldSelectionChrome({ selected: true }))).toBe(true);
    for (const value of [null, [], { selected: "false" }, { available: false }]) {
      expect(() => validateFieldSelectionChrome(value)).toThrow();
    }
  });
  test("rebinding the same source preserves expanded relationships during selection updates", () => {
    const model = create();
    model.toggle("manager");
    model.select("manager/email", true);
    model.source = { schema, entitySet: "People" };
    model.value = [];
    expect(model.rows.some(row => row.path === "manager/email")).toBe(true);
    expect(model.rows.find(row => row.path === "manager")?.expanded).toBe(true);
  });
  test("direct fields can be shown, hidden and ordered without mutating the source", () => {
    const fields = [{ path: "a", label: "Alpha" }, { path: "b" }, { path: "c" }];
    const model = new FieldSelectionModel({ fields }, ["a", "b"]);
    expect(model.select("c", true)).toBe(true);
    expect(model.move("c", -1)).toBe(true);
    expect(model.value).toEqual(["a", "c", "b"]);
    expect(model.select("a", false)).toBe(true);
    expect(model.value).toEqual(["c", "b"]);
    expect(fields.map((field) => field.path)).toEqual(["a", "b", "c"]);
    expect(model.select("c", true)).toBe(false);
    expect(model.move("b", 1)).toBe(false);
  });

  test("to-one and to-many relationships expand one level and emit complete labelled relative paths", () => {
    const model = create();
    expect(model.rows.map((row) => row.path)).toEqual(["id", "name", "email", "manager", "tasks"]);
    expect(model.toggle("manager")).toBe(true);
    expect(model.toggle("tasks")).toBe(true);
    expect(model.rows.find((row) => row.path === "tasks")?.collection).toBe(true);
    model.select("manager/name", true);
    model.select("tasks/title", true);
    expect(model.change).toEqual({ value: ["manager/name", "tasks/title"], fields: [
      { path: "manager/name", label: "manager › Full name" }, { path: "tasks/title", label: "tasks › Task title" },
    ] });
  });

  test("display filters and search preserve selection, including collapsed descendants", () => {
    const model = create();
    model.value = ["name", "tasks/owner/email"];
    model.toggle("tasks");
    model.toggle("tasks/owner");
    model.filter = "direct";
    expect(model.rows.map((row) => row.path)).toEqual(["id", "name", "email"]);
    model.filter = "related";
    expect(model.rows.some((row) => row.path === "name")).toBe(false);
    expect(model.rows.some((row) => row.path === "tasks/owner/email")).toBe(true);
    model.search = "nothing matches";
    expect(model.rows).toEqual([]);
    expect(model.value).toEqual(["name", "tasks/owner/email"]);
    model.search = "email";
    expect(model.rows.map((row) => row.path)).toEqual(["tasks", "tasks/owner", "tasks/owner/email"]);
    model.toggle("tasks");
    expect(model.value).toEqual(["name", "tasks/owner/email"]);
    model.toggle("tasks");
    expect(model.rows.some((row) => row.path === "tasks/owner/email")).toBe(true);
  });

  test("search matches labels and full paths without implicitly expanding any relationship", () => {
    const model = create();
    model.search = "full name";
    expect(model.rows.map((row) => row.path)).toEqual(["name"]);
    model.search = "manager/email";
    expect(model.rows).toEqual([]);
    model.toggle("manager");
    expect(model.rows.map((row) => row.path)).toEqual(["manager", "manager/email"]);
  });

  test("schema cycles require explicit expansion and stop at a visible depth refusal", () => {
    const model = create();
    model.maxDepth = 2;
    model.toggle("manager");
    const branch = model.rows.find((row) => row.path === "manager/manager");
    expect(branch?.reason).toContain("Maximum relationship depth (2)");
    expect(model.toggle("manager/manager")).toBe(false);
    expect(model.rows.some((row) => row.path === "manager/manager/name")).toBe(false);
    model.maxDepth = 3;
    expect(model.toggle("manager/manager")).toBe(true);
    model.select("manager/manager/name", true);
    model.maxDepth = 1;
    expect(model.value).toEqual(["manager/manager/name"]);
    expect(model.selected[0]?.label).toBe("manager › manager › Full name");
  });

  test("invalid fields and source replacements are rejected without losing existing intent", () => {
    const model = create();
    model.value = ["name"];
    for (const path of ["gone", "tasks/gone", "name/email", "tasks", "name/", "/name", " name"]) {
      expect(() => model.select(path, true)).toThrow();
    }
    expect(() => { model.value = ["name", "name"]; }).toThrow("Duplicate");
    expect(() => { model.value = ["name", "tasks/owner/gone"]; }).toThrow();
    expect(() => { model.source = { fields: [{ path: "email" }] }; }).toThrow();
    expect(model.source).toEqual({ schema, entitySet: "People" });
    expect(model.value).toEqual(["name"]);
    expect(() => model.toggle("gone")).toThrow("Unknown relationship");
  });

  test("policy reasons refuse selection, hiding and moving while authored state remains restorable", () => {
    const model = create();
    model.value = ["id", "name"];
    model.policy = { id: { hide: "Required identifier", move: "Keep the identifier first" }, email: { select: "Unavailable in this view" } };
    expect(model.selectionReason("id")).toBe("Required identifier");
    expect(model.selectionReason("email")).toBe("Unavailable in this view");
    expect(model.select("id", false)).toBe(false);
    expect(model.select("email", true)).toBe(false);
    expect(model.move("id", 1)).toBe(false);
    expect(model.value).toEqual(["id", "name"]);
    model.value = ["email"];
    expect(model.value).toEqual(["email"]);
    expect(model.select("email", false)).toBe(true);
  });

  test("flat option sources can constrain supported related fields and search their labels", () => {
    const model = new FieldSelectionModel({ fields: [{ path: "id" }, { path: "owner/name", label: "Owner › Full name" }] });
    model.filter = "related";
    model.search = "full name";
    expect(model.rows.map((row) => row.path)).toEqual(["owner/name"]);
    expect(() => model.select("owner/email", true)).toThrow();
  });

  test("local labels and selected descendant counts survive collapse and filtering", () => {
    const model = create();
    model.value = ["name", "tasks/title", "tasks/owner/email"];
    expect(model.rows.find(row => row.path === "tasks")).toMatchObject({ localLabel: "tasks", selectedCount: 2 });
    model.toggle("tasks");
    model.toggle("tasks/owner");
    expect(model.rows.find(row => row.path === "tasks/title")).toMatchObject({ label: "tasks › Task title", localLabel: "Task title", selectedCount: 0 });
    expect(model.rows.find(row => row.path === "tasks/owner")?.selectedCount).toBe(1);
    model.search = "email";
    expect(model.rows.find(row => row.path === "tasks")?.selectedCount).toBe(2);
    model.search = "";
    model.toggle("tasks");
    expect(model.rows.find(row => row.path === "tasks")?.selectedCount).toBe(2);
    expect(model.value).toEqual(["name", "tasks/title", "tasks/owner/email"]);
    expect(() => model.select("tasks", true)).toThrow();
  });

  test("explicit slash paths remain flat without inferred branches", () => {
    const model = new FieldSelectionModel({ fields: [{ path: "owner/name", label: "Owner › Name" }, { path: "owner/email" }] });
    expect(model.rows.map(row => ({ path: row.path, depth: row.depth, branch: row.branch, localLabel: row.localLabel }))).toEqual([
      { path: "owner/name", depth: 0, branch: false, localLabel: "Owner › Name" },
      { path: "owner/email", depth: 0, branch: false, localLabel: "owner/email" },
    ]);
  });

  test("configuration validators reject malformed YAML data and snapshot accepted arrays", () => {
    expect(validateFieldSelectionSource({ schema, entitySet: "People" })).toEqual({ schema, entitySet: "People" });
    expect(() => validateFieldSelectionSource({ schema, entitySet: "Missing" })).toThrow();
    expect(() => validateFieldSelectionSource({ fields: [], schema })).toThrow();
    expect(() => validateFieldSelectionSource({ entitySet: "People", schema: {} })).toThrow("Schema reference");
    expect(() => validateFieldSelectionFields([{ path: "name", unexpected: true }])).toThrow("Unknown field key");
    expect(() => validateFieldSelectionPolicy({ name: { hide: true } })).toThrow("reason");
    expect(() => validateFieldSelectionPolicy({ name: { edit: "No" } })).toThrow("Unknown field policy");
    expect(() => validateFieldSelectionValue(["name//email"])).toThrow();
    const values = ["name"];
    const validated = validateFieldSelectionValue(values);
    values.push("email");
    expect(validated).toEqual(["name"]);
    const model = create();
    expect(() => { model.maxDepth = 0; }).toThrow();
    expect(() => { model.filter = "unknown" as never; }).toThrow();
  });
});
