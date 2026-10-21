import { expect, type Page } from "@playwright/test";

/** Operate the same Aster choice a visitor uses, rather than a native-select API. */
export async function chooseAppearance(page: Page, name: "Theme" | "Scheme", value: string): Promise<void> {
  const label = value[0]!.toUpperCase() + value.slice(1);
  await chooseOption(page, name, label);
}

export async function chooseOption(page: Page, name: string, label: string): Promise<void> {
  const choice = page.getByRole("combobox", { name, exact: true });
  await choice.click();
  await page.getByRole("listbox", { name, exact: true }).getByRole("option", { name: label, exact: true }).click();
  await expect(choice).toHaveText(label);
}

export async function chooseGrouping(page: Page, fields: string): Promise<void> {
  const label = fields ? fields.split(",").map(field => field[0]!.toUpperCase() + field.slice(1)).join(" → ") : "No grouping";
  await chooseOption(page, "Grouping levels", label);
}
