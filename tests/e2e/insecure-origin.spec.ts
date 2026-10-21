import { networkInterfaces } from "node:os";
import { test, expect } from "@playwright/test";

function lanUrl(baseURL: string, path: string): string {
  const address = Object.values(networkInterfaces()).flat().find(entry => entry?.family === "IPv4" && !entry.internal)?.address;
  if (!address) throw new Error("LAN regression needs a non-loopback IPv4 interface");
  const url = new URL(path, baseURL);
  url.hostname = address;
  return url.href;
}

test("LAN HTTP showcase initializes settings, context and the folder picker", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(lanUrl(baseURL!, "/?memory&time=12&clients=12#showcase/foundations"));
  const preview = page.frameLocator(".showcase-live-preview");
  await expect(preview.locator("#settings").getByRole("button", { name: "General", exact: true })).toBeVisible();
  expect(await preview.locator("html").evaluate(() => isSecureContext)).toBe(false);
  await preview.locator("#settings").getByRole("button", { name: "General", exact: true }).click();
  await expect(preview.getByRole("textbox", { name: "Workspace name", exact: true })).toBeVisible();
  await expect(preview.locator("#hierarchy").getByRole("heading", { name: "Aster", exact: true })).toBeVisible();
  const picker = preview.locator("#folder-picker");
  await picker.getByRole("button", { name: "Select Projects", exact: true }).click();
  await picker.getByRole("button", { name: "Open Projects", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Remove Projects", exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Select Launch notes.md", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("LAN HTTP conversation reader renders without secure-context APIs", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(lanUrl(baseURL!, "/playground/conversations.html"));
  await expect(page.locator(".ac-main .ac-entry")).toHaveCount(24);
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  const identifiers = await page.locator("[id]").evaluateAll(elements => elements.map(element => element.id));
  expect(new Set(identifiers).size).toBe(identifiers.length);
  expect(errors).toEqual([]);
});
