// Static edit policy: form and field defaults, with page rules and metadata
// still deciding first.
import { beforeEach, describe, expect, test } from "bun:test";
import { signal } from "@preact/signals-core";
import { DataContext, EditModel, PageScope, valuesPublication, type ODataRequest } from "@getaster/data";
import { createMockService, type MockService } from "@getaster/mock";
import metadata from "../../fixtures/aster/metadata.json";
import data from "../../fixtures/aster/data.json";

let mock: MockService;
let ctx: DataContext;

beforeEach(async () => {
  mock = await createMockService({ metadata, data, now: () => "2026-10-07T15:20:00Z" });
  ctx = await DataContext.connect(async (request: ODataRequest) => mock.transport(request));
});

async function project(): Promise<EditModel> {
  const records = ctx.collection({ set: "Projects", orderBy: [{ field: "id" }] }, { pageSize: 5 });
  await records.ensure(0, 1);
  return new EditModel(ctx, "Projects", records.keys.value[0]!);
}

describe("edit policy", () => {
  test("form-wide defaults apply, and a field's own default wins", () => {
    return project().then((edit) => {
      edit.applyPolicy({ readOnly: true, disabled: true });
      expect(edit.state("name").value.readOnly).toBe(true);
      expect(edit.state("name").value.enabled).toBe(false);
      edit.applyPolicy({ readOnly: true, disabled: true, fields: { name: { readOnly: false, disabled: false } } });
      expect(edit.state("name").value.readOnly).toBe(false);
      expect(edit.state("name").value.enabled).toBe(true);
      expect(edit.state("budget").value.readOnly).toBe(true);
      expect(edit.state("budget").value.enabled).toBe(false);
      // The static reasons are generic, so a form shows them once.
      expect(edit.state("budget").value.reasons).toMatchObject({ readOnly: "Read-only.", enabled: "Disabled." });
    });
  });

  test("a page rule that names an effect overrides the static default", async () => {
    const edit = await project();
    const scope = new PageScope();
    const on = signal(true);
    scope.publish("page", valuesPublication({ on }));
    const WHEN_ON = { op: "eq", field: "page.on", value: true } as const;
    const WHEN_OFF = { op: "eq", field: "page.on", value: false } as const;
    edit.applyPolicy({ readOnly: true, disabled: true, fields: { behindDays: { required: true } } });
    edit.applyRules(scope, "project", {
      name: { readOnly: { when: WHEN_ON, reason: "The page locked this." } },
      budget: { enabled: { when: WHEN_ON } },
      behindDays: { required: { when: WHEN_OFF } },
    });
    expect(edit.state("name").value.readOnly).toBe(true);
    expect(edit.state("name").value.reasons.readOnly).toBe("The page locked this.");
    expect(edit.state("budget").value.enabled).toBe(true);
    expect(edit.state("behindDays").value.required).toBe(false);
    on.value = false;
    expect(edit.state("name").value.readOnly).toBe(false);
    expect(edit.state("budget").value.enabled).toBe(false);
    expect(edit.state("behindDays").value.required).toBe(true);
  });

  test("metadata still refuses: a computed field is read-only whatever the policy or rule says", async () => {
    const edit = await project();
    const scope = new PageScope();
    const on = signal(false);
    scope.publish("page", valuesPublication({ on }));
    edit.applyPolicy({ readOnly: false });
    edit.applyRules(scope, "project", { createdAt: { readOnly: { when: { op: "eq", field: "page.on", value: true } } } });
    expect(edit.state("createdAt").value.readOnly).toBe(true);
    expect(edit.state("createdAt").value.reasons.readOnly).toContain("set by the server");
  });

  test("read-only and disabled fields refuse a write with the reason", async () => {
    const edit = await project();
    const before = edit.values.value.name;
    edit.applyPolicy({ readOnly: true });
    edit.set("name", "Changed while locked");
    expect(edit.values.value.name).toBe(before);
    expect(edit.errors.value.name?.[0]).toBe("Read-only.");
    edit.applyPolicy({ disabled: true, fields: { name: { disabled: false } } });
    const budget = edit.values.value.budget;
    edit.set("budget", "10");
    expect(edit.values.value.budget).toBe(budget);
    expect(edit.errors.value.budget?.[0]).toBe("Disabled.");
    edit.set("name", "A new name");
    expect(edit.values.value.name).toBe("A new name");
  });

  test("a static required default is validated, and a rule can lift it", async () => {
    const edit = await project();
    edit.applyPolicy({ fields: { behindDays: { required: true } } });
    edit.set("behindDays", null);
    expect(edit.validate()).toBe(false);
    expect(edit.errors.value.behindDays?.[0]).toContain("is required");
    const scope = new PageScope();
    const off = signal(false);
    scope.publish("page", valuesPublication({ off }));
    edit.applyRules(scope, "project", { behindDays: { required: { when: { op: "eq", field: "page.off", value: true } } } });
    expect(edit.validate()).toBe(true);
  });

  test("validateField checks one field and leaves the rest alone", async () => {
    const edit = await project();
    edit.set("name", null);
    expect(edit.validateField("name")).toBe(false);
    expect(edit.errors.value.name?.[0]).toContain("is required");
    expect(edit.errors.value.budget).toBeUndefined();
    edit.set("name", "Named again");
    expect(edit.validateField("name")).toBe(true);
    expect(edit.errors.value.name).toBeUndefined();
  });
});
