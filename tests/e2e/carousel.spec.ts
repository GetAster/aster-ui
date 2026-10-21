// M5: aster-carousel on Home: the APG carousel pattern, one card at a time
// on a phone, with no buttons when every card fits.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { NOW } from "./fixtures.ts";

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Previous and Next move a card at a time and say where they are; a swipe moves it too", async ({ page }) => {
    await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#home`);
    const carousel = page.getByRole("region", { name: "Pinned projects" });
    await expect(carousel).toHaveAttribute("aria-roledescription", "carousel");
    const slides = carousel.getByRole("group");
    await expect(slides).toHaveCount(3);
    await expect(slides.nth(1)).toHaveAttribute("aria-roledescription", "slide");
    await expect(slides.nth(1)).toHaveAttribute("aria-label", "2 of 3: Brand refresh");
    const status = carousel.locator("[aria-live]");
    await expect(status).toHaveText("1 of 3");
    await expect(carousel.getByRole("button", { name: "Previous" })).toBeDisabled();
    await carousel.getByRole("button", { name: "Next" }).click();
    await expect(status).toHaveText("2 of 3");
    await carousel.getByRole("button", { name: "Next" }).click();
    await expect(status).toHaveText("3 of 3");
    await expect(carousel.getByRole("button", { name: "Next" })).toBeDisabled();
    await carousel.locator(".aster-carousel-rail").evaluate((el) => (el.scrollLeft = 0));
    await expect(status).toHaveText("1 of 3");
    await slides.nth(0).getByRole("link", { name: "Open Spring launch" }).click();
    await expect(page).toHaveURL(/#project\/1$/);
  });

  test("axe", async ({ page }) => {
    await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#home`);
    await expect(page.getByRole("region", { name: "Pinned projects" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
});

test("on a desktop every card fits, so there are no buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/?memory&debug&clients=2000&time=200&now=${NOW}#home`);
  const carousel = page.getByRole("region", { name: "Pinned projects" });
  await expect(carousel.getByRole("group")).toHaveCount(3);
  await expect(carousel.getByRole("button", { name: "Next" })).toHaveCount(0);
});
