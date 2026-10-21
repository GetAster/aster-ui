import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("documentation connects the rationale, guide, live example and Grid API", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/reference/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Connected data.");
  await page.locator(".doc-actions").getByRole("link", { name: "Why Aster UI?" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Why Aster UI?");
  await expect(page.getByRole("heading", { name: "When a simple table is sufficient" })).toBeVisible();
  await page.getByRole("link", { name: "Run the example" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get started with Aster UI");
  await page.locator('iframe').scrollIntoViewIfNeeded();
  const demo = page.frameLocator('iframe');
  await expect(demo.getByRole("grid", { name: "Projects", exact: true })).toBeVisible();
  await expect(demo.locator('.aster-grid-row').first()).toBeVisible();
  await expect(page.locator("code.language-javascript .hljs-keyword").first()).toBeVisible();
  await page.locator("main").getByRole("link", { name: "Grid API", exact: false }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Grid");
  await expect(page.locator("#outline").getByRole("link", { name: "Properties", exact: true })).toBeVisible();
  await page.locator("#outline").getByRole("link", { name: "Properties", exact: true }).click();
  await expect(page).toHaveURL(/#class:Grid/);
  expect(errors).toEqual([]);
});

test("search finds guides and API members with keyboard navigation", async ({ page }) => {
  await page.goto("/reference/");
  const input = page.getByRole("searchbox", { name: "Search documentation" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(input).toBeFocused();
  await input.fill("Why Aster");
  const guide = page.locator("#results").getByRole("link", { name: /Why Aster UI/ });
  await expect(guide).toBeVisible();
  await input.press("ArrowDown");
  await expect(guide).toBeFocused();
  await guide.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Why Aster UI?");
  await input.fill("Grid.view");
  await expect(page.locator("#results a").first()).toContainText("Grid.view");
  await input.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grid.view");
  await input.fill("zzzz-no-result");
  await expect(page.locator("#results")).toContainText("No results");
  await input.press("Escape");
  await expect(page.locator("#results")).toBeHidden();
});

test("light and dark documentation is accessible and keeps its colour preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of ["/reference/", "/guide/getting-started.html", "/reference/#class:Grid"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const scheme of ["light", "dark"]) {
      await page.getByRole("combobox", { name: "Colour scheme" }).selectOption(scheme);
      await expect(page.locator("html")).toHaveAttribute("data-scheme", scheme);
      if (path.includes("getting-started")) {
        await page.locator("iframe").evaluate(frame => frame.scrollIntoView({ block: "center", behavior: "instant" }));
        await expect(page.locator("iframe")).toBeInViewport();
        await expect(page.frameLocator("iframe").locator("html")).toHaveAttribute("data-scheme", scheme);
      }
      const violations = (await new AxeBuilder({ page }).analyze()).violations;
      expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
    }
  }
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Colour scheme" })).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
});

test("mobile documentation navigation, articles and code stay within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reference/");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("navigation", { name: "Documentation", exact: true }).getByRole("link", { name: "Get started", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get started with Aster UI");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await menu.click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    searchOutsideHeader: document.querySelector("#search")!.getBoundingClientRect().bottom > document.querySelector("header")!.getBoundingClientRect().bottom,
  }))).toEqual({ overflow: false, searchOutsideHeader: false });
  await expect(page.locator("#nav").getByRole("link", { name: "Get started", exact: true })).toBeHidden();
});

test("published guides have working local links and leave internal docs unpublished", async ({ page, request }) => {
  for (const path of ["/guide/", "/guide/why-aster.html", "/guide/getting-started.html", "/guide/connected-views.html", "/guide/data.html", "/guide/elements.html", "/guide/library.html", "/guide/themes.html", "/reference/#class:Grid"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const links = await page.locator("main a[href]").evaluateAll(nodes => [...new Set(nodes.map(n => (n as HTMLAnchorElement).href))]);
    for (const href of links) {
      const url = new URL(href);
      if (url.origin !== new URL(page.url()).origin) continue;
      expect((await request.get(url.pathname)).status(), href).toBe(200);
    }
  }
  expect((await request.get("/design/calendar.html")).status()).toBe(404);
});


test("skip navigation preserves the API route and copied code is the original source", async ({ page }) => {
  await page.goto("/reference/#class:Grid");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Grid");
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.getByRole("link", { name: "Skip to content" }).press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await expect(page).toHaveURL(/#class:Grid$/);
  await page.goto("/guide/getting-started.html");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { document.body.dataset.copied = value; },
    } });
  });
  const code = page.locator("code.language-javascript").first();
  const expected = await code.textContent();
  await code.locator("xpath=../..").getByRole("button", { name: "Copy javascript code" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-copied", expected!);
  await expect(page.locator("#doc-status")).toHaveText("Code copied to clipboard");
});

test("task navigation exposes layouts and query-wide reporting", async ({ page, request }) => {
  await page.goto("/reference/");
  const navigation = page.getByRole("navigation", { name: "Documentation", exact: true });
  await navigation.getByRole("link", { name: "Compose fields & layouts", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Compose fields and layouts");
  await expect(navigation.getByRole("link", { name: "Fields, layouts & folder selection", exact: true }))
    .toHaveAttribute("href", "../examples/foundations.html");
  await navigation.getByRole("link", { name: "Filter, group & export", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Filter, group and export a collection");
  for (const name of ["expression example", "reporting example"]) {
    const link = page.locator("main").getByRole("link", { name, exact: true });
    const response = await request.get(new URL((await link.getAttribute("href"))!, page.url()).href);
    expect(response.ok()).toBe(true);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("first-visit data guidance separates implementation details and npm installation", async ({ page }) => {
  await page.goto("/reference/");
  const nav = page.getByRole("navigation", { name: "Documentation", exact: true });
  await nav.getByRole("link", { name: "The shared data model", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Understand the shared data model");
  await expect(page.locator("main")).not.toContainText("For reviewers");
  await expect(page.locator("main")).toContainText("WebTransport with SSE fallback");
  await nav.getByRole("link", { name: "Installation & distribution", exact: true }).click();
  await expect(page.locator("main")).toContainText("@getaster");
  await expect(page.locator("main")).toContainText("0.2 release line");
  await expect(page.locator("main")).toContainText("npm install @getaster/data @getaster/elements");
  await nav.getByRole("link", { name: "Data core internals", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Data core internals");
  await page.goto("/guide/");
  const advanced = page.getByRole("heading", { name: /^Implementation details/, level: 2 });
  expect(await advanced.evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('main a[href="../guide/data.html"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
});

for (const width of [1280, 390]) {
  test(`documentation navigation keeps its position across pages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/guide/why-aster.html");
    const nav = page.getByRole("navigation", { name: "Documentation", exact: true });
    const openMenu = async () => {
      if (width === 390) await page.getByRole("button", { name: "Menu", exact: true }).click();
    };
    await openMenu();
    const patterns = nav.getByRole("link", { name: "Customize workspaces", exact: true });
    await patterns.scrollIntoViewIfNeeded();
    const before = await nav.evaluate(element => element.scrollTop);
    expect(before).toBeGreaterThan(100);
    await patterns.click();
    await expect(page.locator("main h1")).toHaveText("Customize and manage workspaces");
    await openMenu();
    await expect.poll(() => nav.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
    await page.reload();
    await expect(page.locator("main h1")).toBeVisible();
    await openMenu();
    await expect.poll(() => nav.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
    const grid = nav.getByRole("link", { name: "Grid", exact: true });
    await grid.scrollIntoViewIfNeeded();
    const atApiLink = await nav.evaluate(element => element.scrollTop);
    await grid.click();
    await expect(page.locator("main h1")).toContainText("Grid");
    await openMenu();
    await expect.poll(() => nav.evaluate(element => element.scrollTop)).toBeCloseTo(atApiLink, 0);
  });
}


test("task search accepts separate words, typos and Enter, and stays closed after Escape", async ({ page }) => {
  await page.goto("/reference/");
  const input = page.getByRole("searchbox", { name: "Search documentation" });
  await input.fill("connect form grid");
  await expect(page.locator("#results a").first()).toContainText("Connect a grid and form");
  await expect(page.locator(".search-result-excerpt").first()).not.toBeEmpty();
  await input.press("Enter");
  await expect(page.locator("main h1")).toHaveText("Connect a grid and form");
  await input.fill("authentcation");
  await expect(page.locator("#results a").first()).toContainText("Authentication");
  await input.press("Escape");
  await expect(page.locator("#results")).toBeHidden();
  await input.fill("TileGrid");
  await expect(page.locator("#results a").first()).toContainText("TileGrid");
});

test("search finds the Webmail example using mail and related terms", async ({ page }) => {
  await page.goto("/reference/");
  const input = page.getByRole("searchbox", { name: "Search documentation" });
  for (const query of ["mail", "email", "inbox"]) {
    await input.fill(query);
    await expect(page.locator("#results a").first()).toContainText("Example: Webmail with sign in");
    await expect(page.locator("#results a").first()).toHaveAttribute("href", /\/examples\/mail\.html$/);
  }
  await input.press("Enter");
  await expect(page.locator("main h1")).toHaveText("Example: Webmail with sign in");
});

test("a slow heading font does not resize text after it is visible", async ({ page }) => {
  let resumeFonts!: () => void;
  const fontsReady = new Promise<void>(resolve => { resumeFonts = resolve; });
  const fontRequests: string[] = [];
  await page.route(/\.ttf$/, async route => {
    if (route.request().url().includes("Geist")) fontRequests.push(route.request().url());
    await fontsReady;
    await route.continue();
  });
  try {
    await page.goto("/guide/why-aster.html", { waitUntil: "domcontentloaded" });
    const heading = page.locator("main h1");
    await expect(heading).toBeVisible();
    // Observe visible text after the browser's short optional-font block period.
    await page.evaluate(async () => { for (let i = 0; i < 15; i++) await new Promise(requestAnimationFrame); });
    const textWidth = () => heading.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().width;
    });
    const before = await textWidth();
    expect(before).toBeGreaterThan(0);
    resumeFonts();
    await page.evaluate(() => document.fonts.ready);
    expect(await textWidth()).toBeCloseTo(before, 1);
    expect(fontRequests).toHaveLength(1);
  } finally {
    resumeFonts();
  }
});
