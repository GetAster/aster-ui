import { describe, expect, test } from "bun:test";
import { parseCsdl, SchemaError } from "../src/schema/csdl.ts";

const demo = await Bun.file(
  new URL("../../../fixtures/aster/metadata.json", import.meta.url),
).json();

const schema = parseCsdl(demo);

function clone(): any {
  return structuredClone(demo);
}

function failure(json: unknown): SchemaError {
  try {
    parseCsdl(json);
  } catch (e) {
    if (e instanceof SchemaError) return e;
    throw e;
  }
  throw new Error("expected SchemaError");
}

describe("parseCsdl: AsterDemo", () => {
  test("sets and types", () => {
    expect(schema.namespace).toBe("AsterDemo");
    expect([...schema.sets.keys()]).toEqual(["People", "Projects", "Clients", "TimeEntries", "Tasks", "Notes", "Members", "ShareLinks", "Fields", "Answers", "Clauses", "Changes"]);
    expect(schema.set("Projects").type.qualifiedName).toBe("AsterDemo.Project");
    expect(schema.types.get("AsterDemo.Task")?.name).toBe("Task");
    expect(() => schema.set("Nope")).toThrow(SchemaError);
  });

  test("keys and fields in declaration order", () => {
    const project = schema.set("Projects").type;
    expect(project.key).toEqual(["id"]);
    expect(project.fields.map((f) => f.name)).toEqual([
      "id", "name", "leadId", "state", "health", "behindDays", "clientId", "budget", "spent",
      "pinned", "hue", "createdAt", "updatedAt", "archivedAt",
    ]);
    expect(project.field("budget")?.type).toBe("Edm.Decimal");
    expect(project.field("nope")).toBeUndefined();
  });

  test("defaults and facets", () => {
    const person = schema.set("People").type;
    const name = person.field("name")!;
    expect(name.type).toBe("Edm.String");
    expect(name.nullable).toBe(false);
    expect(name.maxLength).toBe(80);
    expect(name.minLength).toBe(1);
    expect(name.computed).toBe(false);
    expect(person.field("email")!.nullable).toBe(true);
    const budget = schema.set("Projects").type.field("budget")!;
    expect(budget.precision).toBe(12);
    expect(budget.scale).toBe(2);
  });

  test("annotations", () => {
    const person = schema.set("People").type;
    expect(person.title).toBe("Person");
    expect(person.pluralTitle).toBe("People");
    expect(person.titleField).toBe("name");
    expect(person.annotations["Core.Description"]).toBe("Person");
    expect(person.field("id")!.computed).toBe(true);
    expect(person.field("name")!.title).toBe("Name");
    expect(person.field("email")!.pattern).toBe("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$");
    const hue = person.field("hue")!;
    expect([hue.minimum, hue.maximum]).toEqual([0, 359]);
    expect(hue.exclusiveMinimum).toBeUndefined();
  });

  test("allowed values", () => {
    expect(schema.set("Projects").type.field("state")!.allowedValues).toEqual([
      { value: "active", label: "Active" },
      { value: "paused", label: "Paused" },
      { value: "archived", label: "Archived" },
    ]);
  });

  test("to-one navigation", () => {
    const lead = schema.set("Projects").type.navigation("lead")!;
    expect(lead).toEqual({ name: "lead", target: "People", collection: false, keys: [["leadId", "id"]], owned: false });
  });

  test("to-many navigation inverts the partner's constraint", () => {
    const tasks = schema.set("Projects").type.navigation("tasks")!;
    expect(tasks.target).toBe("Tasks");
    expect(tasks.collection).toBe(true);
    expect(tasks.keys).toEqual([["id", "projectId"]]);
    expect(tasks.partner).toBe("project");
    const project = schema.set("Tasks").type.navigation("project")!;
    expect(project.partner).toBe("tasks");
    expect(project.keys).toEqual([["projectId", "id"]]);
  });

  test("etag, restrictions, immutability", () => {
    expect(schema.set("Projects").etag).toBe(true);
    expect(schema.set("Projects").nonFilterable.size).toBe(0);
    expect(Object.isFrozen(schema.set("Projects").type.fields)).toBe(true);
    expect(() => (schema.sets as Map<string, unknown>).delete("Projects")).toThrow();
    expect(() => (schema.set("Projects").nonFilterable as Set<string>).add("x")).toThrow();
  });
});

describe("parseCsdl: rules", () => {
  test("a full-namespace annotation lands under the alias, qualifiers kept", () => {
    const j = clone();
    j.AsterDemo.Person["@Org.OData.Core.V1.LongDescription"] = "long";
    j.AsterDemo.Person.name["@Org.OData.Core.V1.Description"] = "Full name";
    j.AsterDemo.Person.name["@Core.Description#short"] = "N";
    j.AsterDemo.Person.hue["@Org.OData.Validation.V1.Minimum@Org.OData.Validation.V1.Exclusive"] = true;
    const person = parseCsdl(j).set("People").type;
    expect(person.annotations["Core.LongDescription"]).toBe("long");
    expect(person.field("name")!.title).toBe("Full name");
    expect(person.field("name")!.annotations["Core.Description#short"]).toBe("N");
    expect(person.field("hue")!.exclusiveMinimum).toBe(true);
  });

  test("a namespace without alias resolves to itself", () => {
    const j = clone();
    delete j.$Reference["https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json"].$Include[0].$Alias;
    j.AsterDemo.Person["@Org.OData.Core.V1.LongDescription"] = "long";
    const person = parseCsdl(j).set("People").type;
    expect(person.annotations["Org.OData.Core.V1.LongDescription"]).toBe("long");
  });

  test("filter and sort restrictions, string or path items", () => {
    const j = clone();
    j.AsterDemo.Container.People["@Capabilities.FilterRestrictions"] = {
      NonFilterableProperties: [{ $PropertyPath: "email" }, "hue"],
    };
    j.AsterDemo.Container.People["@Org.OData.Capabilities.V1.SortRestrictions"] = {
      NonSortableProperties: ["email"],
    };
    const people = parseCsdl(j).set("People");
    expect([...people.nonFilterable]).toEqual(["email", "hue"]);
    expect([...people.nonSortable]).toEqual(["email"]);
  });

  test("etag from any OptimisticConcurrency list, even empty; owned only from AsterData.Owned", () => {
    const j = clone();
    j.AsterDemo.Container.People["@Core.OptimisticConcurrency"] = [];
    j.AsterDemo.Project.tasks["@AsterData.Owned"] = true;
    j.AsterDemo.Task.assignee.$OnDelete = "Cascade";
    const s = parseCsdl(j);
    expect(s.set("People").etag).toBe(true);
    delete j.AsterDemo.Container.People["@Core.OptimisticConcurrency"];
    expect(parseCsdl(j).set("People").etag).toBe(false);
    expect(s.set("Projects").type.navigation("tasks")!.owned).toBe(true);
    expect(s.set("Tasks").type.navigation("assignee")!.owned).toBe(false);
    expect(s.set("Tasks").type.navigation("project")!.owned).toBe(false);
  });

  test("default value, root value and empty-as-null from the property", () => {
    const j = clone();
    j.AsterDemo.Task.title["@AsterData.EmptyAsNull"] = true;
    j.AsterDemo.Task.done.$DefaultValue = false;
    j.AsterDemo.Task.parentId["@AsterData.RootValue"] = 0;
    const t = parseCsdl(j).set("Tasks").type;
    expect(t.field("title")!.emptyAsNull).toBe(true);
    expect(t.field("done")!.defaultValue).toBe(false);
    expect(t.field("parentId")!.rootValue).toBe(0);
    expect(t.field("due")).not.toHaveProperty("emptyAsNull");
  });

  test("properties it can't model are skipped and listed; the rest stands", () => {
    const j = clone();
    j.AsterDemo.Person.photo = { $Type: "Edm.Stream" };
    j.AsterDemo.Person.extras = { $Type: "Edm.Untyped", $Nullable: true };
    j.AsterDemo.Person.tags = { $Type: "Edm.String", $Collection: true };
    j.AsterDemo.Person.colour = { $Type: "AsterDemo.Colour" };
    const s = parseCsdl(j);
    expect(s.skipped.map((x) => x.path)).toEqual([
      "/AsterDemo/Person/photo",
      "/AsterDemo/Person/extras",
      "/AsterDemo/Person/tags",
      "/AsterDemo/Person/colour",
    ]);
    const person = s.set("People").type;
    expect(person.field("photo")).toBeUndefined();
    expect(person.field("name")).toBeDefined();
    expect(schema.skipped).toEqual([]);
  });

  test("a derived type has its base type's key and properties", () => {
    const j = clone();
    j.AsterDemo.Party = { $Kind: "EntityType", $Abstract: true, $Key: ["id"], id: { $Type: "Edm.Int32" }, note: { $Nullable: true } };
    const { $Key: _, id: __, ...rest } = j.AsterDemo.Person;
    j.AsterDemo.Person = { ...rest, $BaseType: "AsterDemo.Party" };
    const person = parseCsdl(j).set("People").type;
    expect(person.key).toEqual(["id"]);
    expect(person.fields.map((f) => f.name).slice(0, 2)).toEqual(["id", "note"]);
    expect(person.field("name")).toBeDefined();
  });

  test("types in a second namespace, by namespace or alias", () => {
    const j = clone();
    j.Shared = { $Alias: "S", Tag: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, label: {} } };
    j.AsterDemo.Container.Tags = { $Collection: true, $Type: "S.Tag" };
    const s = parseCsdl(j);
    expect(s.namespace).toBe("AsterDemo");
    expect(s.set("Tags").type.qualifiedName).toBe("Shared.Tag");
    expect(s.set("Projects").type.qualifiedName).toBe("AsterDemo.Project");
  });

  test("the schema $Alias resolves type names", () => {
    const j = clone();
    j.AsterDemo.$Alias = "AD";
    j.AsterDemo.Project.lead.$Type = "AD.Person";
    expect(parseCsdl(j).set("Projects").type.navigation("lead")!.target).toBe("People");
  });
});

describe("parseCsdl: errors carry paths", () => {
  test("not an object", () => {
    expect(failure(null).path).toBe("");
  });

  test("missing container", () => {
    const j = clone();
    delete j.$EntityContainer;
    expect(failure(j).path).toBe("/$EntityContainer");
  });

  test("a type outside the document", () => {
    const j = clone();
    j.AsterDemo.Project.lead.$Type = "Elsewhere.Person";
    const e = failure(j);
    expect(e.path).toBe("/AsterDemo/Project/lead/$Type");
    expect(e.message).toContain("/AsterDemo/Project/lead/$Type");
  });

  test("key naming a missing property", () => {
    const j = clone();
    j.AsterDemo.Person.$Key = ["nope"];
    expect(failure(j).path).toBe("/AsterDemo/Person/$Key/0");
  });

  test("bad facet", () => {
    const j = clone();
    j.AsterDemo.Person.name.$MaxLength = "80";
    expect(failure(j).path).toBe("/AsterDemo/Person/name/$MaxLength");
  });

  test("binding to a missing set", () => {
    const j = clone();
    j.AsterDemo.Container.Projects.$NavigationPropertyBinding.lead = "Nobody";
    expect(failure(j).path).toBe("/AsterDemo/Container/Projects/$NavigationPropertyBinding/lead");
  });

  test("bad allowed values", () => {
    const j = clone();
    j.AsterDemo.Project.state["@Validation.AllowedValues"] = "x";
    expect(failure(j).path).toBe("/AsterDemo/Project/state/@Validation.AllowedValues");
  });

  test("a base type cycle", () => {
    const j = clone();
    j.AsterDemo.Person.$BaseType = "AsterDemo.Person";
    expect(failure(j).path).toBe("/AsterDemo/Person/$BaseType");
  });
});
