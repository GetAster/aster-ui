// Which sets the metadata makes a tree, and so which foreign keys a form gives a tree picker.
import { expect, test } from "bun:test";
import { DataContext } from "@getaster/data";
import { createMockService } from "@getaster/mock";
import { TreeChoices } from "../../packages/elements/src/picker/tree-choices.ts";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";

const connect = async () => DataContext.connect((await createMockService({ metadata, data })).transport);

test("a set with a single-valued navigation to itself is a tree, parented by the field that navigation names", async () => {
  const ctx = await connect();
  const tasks = TreeChoices.of(ctx, "Tasks");
  expect(tasks?.spec).toMatchObject({ set: "Tasks", parentField: "parentId" });
  expect(tasks?.display).toBe("title");
  expect(tasks?.canChoose({ id: 1 })).toBe(true);
});

test("a set that points at other sets only is not a tree", async () => {
  const ctx = await connect();
  expect(TreeChoices.of(ctx, "Projects")).toBeUndefined();
  expect(TreeChoices.of(ctx, "People")).toBeUndefined();
});

test("the choices are shared per context and set, and the answer is remembered", async () => {
  const [one, other] = [await connect(), await connect()];
  expect(TreeChoices.of(one, "Tasks")).toBe(TreeChoices.of(one, "Tasks"));
  expect(TreeChoices.of(one, "Tasks")).not.toBe(TreeChoices.of(other, "Tasks"));
  expect(TreeChoices.of(one, "Projects")).toBeUndefined();
  expect(TreeChoices.of(one, "Projects")).toBeUndefined();
});
