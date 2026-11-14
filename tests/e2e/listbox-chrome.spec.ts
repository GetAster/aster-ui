// The listbox's caret chrome and its selected-row fill variable.
import { expect, test } from "@playwright/test";
import { open } from "./fixtures.ts";

test("chrome.caret hides the sliding caret and keeps the selected fill, which a placement can restyle", async ({ page }) => {
  await open(page);
  const list = page.locator("#projects-list");
  const selected = list.locator('[role="option"][aria-selected="true"]');
  const caret = list.locator("aster-caret-group > .aster-caret");
  await expect(selected).toHaveCount(1);
  await expect(caret).toHaveCSS("opacity", "1");
  await expect(caret).toBeVisible();
  const fill = await selected.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(fill).not.toBe("rgba(0, 0, 0, 0)");

  await list.evaluate((el: any) => { el.chrome = { caret: false }; });
  await expect(caret).toHaveCSS("display", "none");
  await expect(selected).toHaveCSS("background-color", fill);

  await list.evaluate((el: any) => { el.chrome = {}; });
  await expect(caret).toBeVisible();

  await list.evaluate((el) => el.style.setProperty("--aster-listbox-selected-fill", "rgb(255, 0, 0)"));
  await expect(selected).toHaveCSS("background-color", "rgb(255, 0, 0)");
});

test("the composition validator accepts the listbox chrome data and rejects bad values", async ({ page }) => {
  await page.goto("/playground/composition.html");
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const authoring = lib.defineCompositeRegistry({
      models: { empty: lib.defineCompositeModel({ inputs: {}, exports: {}, create: () => ({ values: {} }) }) },
      components: lib.asterComponents,
    });
    const diagnostics = (props: object) => authoring.diagnostics({
      version: 1, name: "listbox-test", model: { type: "empty" }, children: { control: { type: "Listbox", props } }, layout: { child: "control" },
    });
    return {
      valid: [diagnostics({ chrome: { caret: false } }), diagnostics({ chrome: {} }), diagnostics({ chrome: { caret: true } })],
      invalid: [diagnostics({ chrome: { caret: "no" } }), diagnostics({ chrome: { bar: false } })],
    };
  });
  for (const diagnostics of result.valid) expect(diagnostics).toEqual([]);
  for (const diagnostics of result.invalid) expect(diagnostics).toHaveLength(1);
});
