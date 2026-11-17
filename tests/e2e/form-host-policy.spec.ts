import { expect, test, pageUrl } from "./cdp.ts";

const fixture = {
  metadata: { $Version: "4.01", $EntityContainer: "Test.Container", Test: {
    Record: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, name: { $Nullable: true } },
    Container: { $Kind: "EntityContainer", Records: { $Collection: true, $Type: "Test.Record" } },
  } },
  data: { Records: [{ id: 1, name: "Ada" }] },
};

test("two Form hosts preserve session policy and narrow only their own guarded controls", async ({ page }) => {
  await page.goto(pageUrl("/playground/composition.html"));
  await page.evaluate(async (fixture) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const mockLib = await import("/lib/aster-ui-mock.js" as string);
    const mock = await mockLib.createMockService({ ...fixture, wasm: new URL("/lib/odata_mock.wasm", location.href) });
    const ctx = await lib.DataContext.connect(mock.transport);
    const records = ctx.collection({ set: "Records" }, { pageSize: 5 });
    await records.ensure(0, 5);
    const edit = new lib.EditModel(ctx, "Records", records.keys.value[0]);
    edit.applyPolicy({ readOnly: true, fields: { name: { required: true } } });
    const hosts = ["locked", "editable"].map(id => {
      const form = document.createElement("aster-form") as HTMLElement & Record<string, any>;
      form.id = id;
      form.model = edit;
      form.sections = [{ title: id, items: ["name"] }];
      return form;
    });
    hosts[0]!.readOnly = true;
    document.body.append(...hosts);
    (globalThis as any).hostPolicy = { edit, hosts };
  }, fixture);
  expect(await page.evaluate(() => (globalThis as any).hostPolicy.edit.state("name").value.readOnly)).toBe(true);
  await expect(page.locator("#editable input")).toHaveAttribute("readonly", "");
  await page.evaluate(() => {
    const { edit, hosts } = (globalThis as any).hostPolicy;
    hosts[0].remove();
    if (!edit.state("name").value.readOnly) throw new Error("Removing a host cleared session policy");
    edit.applyPolicy({ fields: { name: { required: true } } });
    hosts[0].readOnly = true;
    document.body.append(hosts[0]);
  });
  await expect(page.locator("#locked input")).toHaveAttribute("readonly", "");
  await expect(page.locator("#editable input")).not.toHaveAttribute("readonly", "");
  await page.locator("#locked input").evaluate(input => {
    (input as HTMLInputElement).value = "Forged";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  expect(await page.evaluate(() => (globalThis as any).hostPolicy.edit.values.value.name)).toBe("Ada");
  await page.locator("#editable input").fill("Grace");
  expect(await page.evaluate(() => (globalThis as any).hostPolicy.edit.values.value.name)).toBe("Grace");
  await page.evaluate(() => { (globalThis as any).hostPolicy.hosts[0].disabled = true; (globalThis as any).hostPolicy.hosts[0].readOnly = false; });
  await expect(page.locator("#locked input")).toBeDisabled();
  await expect(page.locator("#editable input")).toBeEnabled();
  await page.evaluate(() => { (globalThis as any).hostPolicy.hosts[0].remove(); });
  expect(await page.evaluate(() => (globalThis as any).hostPolicy.edit.state("name").value.required)).toBe(true);
});
