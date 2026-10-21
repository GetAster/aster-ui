import { expect, test } from "bun:test";
import { FilterDraft, filterOperators, type FilterNode } from "../src/criteria/filter-draft.ts";
import type { Criteria } from "../src/criteria/ast.ts";
import { toFilter } from "../src/criteria/compile.ts";
import { parseCsdl } from "../src/schema/csdl.ts";
import { ALL_TYPES_CSDL } from "./truth-table.ts";
const schema = parseCsdl(ALL_TYPES_CSDL);
test("query operators reflect text, quantities, dates, booleans, identifiers and finite choices", () => {
  const type = schema.set("Rs").type;
  const text = filterOperators(type.field("s"));
  expect(text).toEqual(expect.arrayContaining(["eq", "ne", "in", "contains", "startswith", "endswith"]));
  for (const op of ["gt", "ge", "lt", "le"]) expect(text).not.toContain(op);
  for (const field of ["i", "l", "d", "f", "date", "ts", "time", "dur"]) {
    const ops = filterOperators(type.field(field));
    expect(ops).toEqual(expect.arrayContaining(["gt", "ge", "lt", "le"]));
    expect(ops).not.toContain("contains");
  }
  for (const field of [type.field("b"), type.field("g"), { ...type.field("s")!, allowedValues: [{ value: "active" }, { value: "paused" }] }]) {
    expect(filterOperators(field)).toEqual(["eq", "ne", "in", "isnull", "notnull"]);
  }
  expect(filterOperators(type.field("bin"))).toEqual([]);
});
test("changing a numeric comparison to text requires repairing its operator without rewriting the saved query", () => {
  const saved = { op: "gt", field: "i", value: 5 } as const;
  const draft = new FilterDraft(schema, "Rs", saved);
  const clause = draft.root.value.children[0]!;
  draft.change(clause.id, { field: "s" });
  expect(draft.result.value.valid).toBe(false);
  expect(draft.apply()).toBe(false);
  expect(draft.applied.value).toEqual(saved);
  draft.change(clause.id, { op: "contains" });
  expect(draft.result.value.criteria).toEqual({ op: "contains", field: "s", value: "5" });
  const imported = new FilterDraft(schema, "Rs", { op: "gt", field: "s", value: "Alice" });
  expect(imported.result.value.valid).toBe(false);
  expect(imported.applied.value).toEqual({ op: "gt", field: "s", value: "Alice" });
});
const criteria: Criteria[] = [
  ...(["eq","ne","gt","ge","lt","le"] as const).map(op => ({op,field:"i",value:3})),
  {op:"eq",field:"l",value:"9007199254740993"}, {op:"eq",field:"d",value:"12345678901234567890.1200"},
  {op:"eq",field:"b",value:false}, {op:"eq",field:"s",value:""},
  {op:"eq",field:"s",value:null}, {op:"ne",field:"s",value:null},
  {op:"in",field:"i",values:[1,null,3]}, {op:"in",field:"s",values:[]},
  {op:"contains",field:"s",value:"A",caseInsensitive:true}, {op:"startswith",field:"s",value:"a"}, {op:"endswith",field:"s",value:"b"},
  {op:"lt",field:"d",other:"d2"}, {op:"ge",field:"date",value:{relative:"today",weeks:-1,startOf:"week"}},
  {op:"or",args:[{op:"eq",field:"i",value:1},{op:"not",arg:{op:"and",args:[{op:"eq",field:"b",value:true},{op:"eq",field:"s",value:"x"}]}}]},
];
for (const [i,c] of criteria.entries()) test(`round-trips typed expression ${i+1}`,()=> {
  const draft = new FilterDraft(schema,"Rs",c);
  expect(draft.result.value.problems).toEqual([]);
  expect(draft.result.value.criteria).toEqual(c);
  expect(draft.apply()).toBe(true);
  expect(draft.applied.value).toEqual(c);
});
test("invalid draft never commits partial OR or NOT; cancel restores a snapshot",()=> {
  const saved: Criteria = {op:"or",args:[{op:"eq",field:"i",value:1},{op:"eq",field:"i",value:2}]};
  const draft=new FilterDraft(schema,"Rs",saved);
  const second=draft.root.value.children[1]!;
  draft.change(second.id,{text:"nonsense"});
  expect(draft.dirty.value).toBe(true);
  expect(draft.result.value.valid).toBe(false);
  expect(draft.result.value.criteria).toBeUndefined();
  expect(draft.apply()).toBe(false);
  expect(draft.applied.value).toEqual(saved);
  draft.cancel();
  expect(draft.dirty.value).toBe(false);
  expect(draft.result.value.criteria).toEqual(saved);
  expect(draft.applied.value).not.toBe(saved);
});
test("draft-only clear, nested removal and incomplete groups",()=> {
  const draft=new FilterDraft(schema,"Rs",criteria[0]);
  const applied=draft.applied.value;
  draft.clear();
  expect(draft.applied.value).toEqual(applied);
  expect(draft.result.value).toEqual({valid:true,criteria:undefined,problems:[]});
  const group=draft.add(draft.root.value.id,"group");
  expect(draft.apply()).toBe(false);
  const child=draft.add(group);
  draft.change(child,{field:"b",text:"true"});
  expect(draft.result.value.valid).toBe(true);
  draft.remove(group);
  expect(draft.result.value.criteria).toBeUndefined();
  expect(draft.apply()).toBe(true);
  expect(draft.applied.value).toBeUndefined();
});
test("missing field is retained and blocks the whole expression",()=> {
  const c: Criteria={op:"or",args:[{op:"eq",field:"missing",value:"x"},criteria[0]!]};
  const draft=new FilterDraft(schema,"Rs",c);
  expect(draft.root.value.children).toHaveLength(2);
  expect(draft.result.value.valid).toBe(false);
  expect(draft.applied.value).toEqual(c);
  expect(draft.apply()).toBe(false);
});
test("typed lists, incompatible field comparisons and relative offsets are rejected",()=> {
  for (const c of [{op:"in",field:"i",values:["1"]},{op:"eq",field:"i",other:"s"},{op:"eq",field:"i",value:1.5},{op:"ge",field:"date",value:{relative:"today",days:1.5}}] as Criteria[]) {
    expect(new FilterDraft(schema,"Rs",c).result.value.valid).toBe(false);
  }
});
test("related groups preserve any/all/via scope",()=> {
  const related=parseCsdl({$Version:"4.01",$EntityContainer:"T.C",T:{
    R:{$Kind:"EntityType",$Key:["id"],id:{$Type:"Edm.Int32"},name:{},parentId:{$Type:"Edm.Int32"},parent:{$Kind:"NavigationProperty",$Type:"T.R",$ReferentialConstraint:{parentId:"id"}},children:{$Kind:"NavigationProperty",$Type:"T.R",$Collection:true,$Partner:"parent"}},
    C:{$Kind:"EntityContainer",Rs:{$Collection:true,$Type:"T.R"}}
  }});
  const scope={op:"eq",field:"name",value:"Alice"} as const;
  const expressions: Criteria[]=[{op:"any",field:"children",where:scope},{op:"all",field:"children",where:{op:"not",arg:scope}},{op:"via",field:"parent",where:scope}];
  for(const c of expressions){
    const draft=new FilterDraft(related,"Rs",c);
    expect(draft.result.value.problems).toEqual([]);
    expect(draft.result.value.criteria).toEqual(c);
    expect(toFilter(draft.result.value.criteria!,related.set("Rs").type,undefined,related)).toBeTruthy();
    const walk=(n:FilterNode):void=>{expect(draft.typeFor(n.id)?.name).toBe("R");if(n.kind!=="condition")n.children.forEach(walk);};
    walk(draft.root.value);
  }
  expect(new FilterDraft(related,"Rs",{op:"any",field:"parent",where:scope}).result.value.valid).toBe(false);
});


test("finite choices preserve typed values across equality and membership without accepting unavailable choices", () => {
  const choices = parseCsdl({ ...ALL_TYPES_CSDL, T: { ...ALL_TYPES_CSDL.T, R: { ...ALL_TYPES_CSDL.T.R,
    s: { "@Validation.AllowedValues": [{ Value: "Linux" }, { Value: "Windows" }] },
    i: { $Type: "Edm.Int32", $Nullable: true, "@Validation.AllowedValues": [{ Value: 1 }, { Value: 2 }] },
  } } });
  for (const [field, value] of [["s", "Linux"], ["i", 1], ["b", true]] as const) {
    const draft = new FilterDraft(choices, "Rs", { op: "eq", field, value });
    const id = draft.root.value.children[0]!.id;
    draft.change(id, { op: "in" });
    expect(draft.result.value.criteria).toEqual({ op: "in", field, values: [value] });
    draft.change(id, { op: "ne" });
    expect(draft.result.value.criteria).toEqual({ op: "ne", field, value });
  }
  const draft = new FilterDraft(choices, "Rs", { op: "in", field: "i", values: [null, 2] });
  expect(draft.result.value.valid).toBe(true);
  const id = draft.root.value.children[0]!.id;
  for (const text of ["[]", '["2"]', '[3]']) {
    draft.change(id, { text });
    expect(draft.apply()).toBe(false);
    expect(draft.applied.value).toEqual({ op: "in", field: "i", values: [null, 2] });
  }
  draft.change(id, { text: "[2]", op: "in" });
  draft.change(id, { op: "eq" });
  expect(draft.result.value.criteria).toEqual({ op: "eq", field: "i", value: 2 });
});


for (const [field, values] of [
  ["l", ["9007199254740992", "9007199254740993", null]],
  ["d", ["123456789012345678.1234567890", "123456789012345678.1234567891", null]],
] as const) {
  test(`exact ${field} membership survives draft edits and OData compilation`, () => {
    const criteria: Criteria = { op: "in", field, values: [...values] };
    const draft = new FilterDraft(schema, "Rs", criteria);
    expect(draft.result.value.problems).toEqual([]);
    expect(draft.result.value.criteria).toEqual(criteria);
    expect(toFilter(criteria, schema.set("Rs").type)).toBe(`${field} in (${values.map((value) => value === null ? "null" : value).join(",")})`);
    const clause = draft.root.value.children[0]!;
    draft.change(clause.id, { text: JSON.stringify([values[1]]) });
    expect(draft.apply()).toBe(true);
    expect(draft.applied.value).toEqual({ op: "in", field, values: [values[1]] });
    const restored = new FilterDraft(schema, "Rs", draft.applied.value);
    expect(restored.result.value.criteria).toEqual(draft.applied.value);
  });
}
