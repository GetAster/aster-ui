import { expect, test, type Locator, type Page } from "@playwright/test";

/** A page with the library loaded and an empty lab to build controls in. */
async function lab(page: Page) {
  await page.goto("/playground/control-states.html");
  await expect(page.locator("#measures")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    document.querySelector("#measures")!.replaceChildren();
    const lab = document.createElement("div");
    lab.id = "lab";
    lab.style.cssText = "width: 520px; padding: 16px";
    document.body.prepend(lab);
  });
}

type Props = Record<string, unknown>;

async function add(page: Page, tag: string, props: Props, id = "subject"): Promise<Locator> {
  await page.evaluate(([tag, props, id]) => {
    const el = document.createElement(tag as string) as HTMLElement & Record<string, unknown>;
    el.id = id as string;
    Object.assign(el, props);
    document.querySelector("#lab")!.append(el);
    (window as unknown as { events: unknown[] }).events ??= [];
    for (const type of ["value-input", "value-change"]) el.addEventListener(type, (e) => (window as unknown as { events: unknown[] }).events.push({ type, detail: (e as CustomEvent).detail }));
  }, [tag, props, id] as const);
  return page.locator(`#${id}`);
}

const events = (page: Page) => page.evaluate(() => (window as unknown as { events: { type: string; detail: unknown }[] }).events);
const now = (thumb: Locator) => thumb.getAttribute("aria-valuenow").then(Number);

async function box(el: Locator) {
  return (await el.boundingBox())!;
}

async function dragTo(page: Page, thumb: Locator, rail: Locator, fraction: number, release = true) {
  const t = await box(thumb);
  const r = await box(rail);
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * fraction, r.y + r.height / 2, { steps: 6 });
  if (release) await page.mouse.up();
}

test.describe("slider keyboard and semantics (WAI-ARIA APG)", () => {
  test("a thumb is a named slider with its range and value text, and every APG key works", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Volume", labelled: true, value: 40, step: 5, format: { unit: "dB" } });
    const thumb = slider.getByRole("slider", { name: "Volume" });
    await expect(thumb).toHaveAttribute("aria-valuemin", "0");
    await expect(thumb).toHaveAttribute("aria-valuemax", "100");
    await expect(thumb).toHaveAttribute("aria-valuenow", "40");
    await expect(thumb).toHaveAttribute("aria-valuetext", "40 dB");
    await expect(thumb).toHaveAttribute("aria-orientation", "horizontal");
    await thumb.focus();
    for (const [key, expected] of [["ArrowRight", 45], ["ArrowUp", 50], ["ArrowLeft", 45], ["ArrowDown", 40], ["PageUp", 50], ["PageDown", 40], ["End", 100], ["Home", 0], ["ArrowLeft", 0]] as const) {
      await page.keyboard.press(key);
      expect(await now(thumb), key).toBe(expected);
    }
    await expect(thumb).toHaveAttribute("aria-valuetext", "0 dB");
    const changes = (await events(page)).filter((e) => e.type === "value-change");
    expect(changes.slice(0, 3).map((e) => e.detail)).toEqual([{ value: 45 }, { value: 50 }, { value: 45 }]);
    // Home at the minimum changes nothing, so it does not announce a change.
    expect(changes.at(-1)!.detail).toEqual({ value: 0 });
  });

  test("a read-only slider stays focusable and announced but refuses change; a disabled one leaves the tab order", async ({ page }) => {
    await lab(page);
    const fixed = await add(page, "aster-slider", { label: "Fixed", labelled: true, value: 50, readOnly: true }, "fixed");
    const off = await add(page, "aster-slider", { label: "Off", labelled: true, value: 50, disabled: true }, "off");
    const thumb = fixed.getByRole("slider", { name: "Fixed" });
    await expect(thumb).toHaveAttribute("aria-readonly", "true");
    await thumb.focus();
    await expect(thumb).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("End");
    expect(await now(thumb)).toBe(50);
    const t = await box(thumb);
    await page.mouse.click(t.x + t.width / 2 + 60, t.y + t.height / 2);
    expect(await now(thumb)).toBe(50);
    const disabled = off.locator('[role="slider"][aria-label="Off"], [role="slider"][aria-labelledby]');
    await expect(disabled).toHaveAttribute("aria-disabled", "true");
    await expect(disabled).toHaveAttribute("tabindex", "-1");
    expect(await events(page)).toEqual([]);
  });

  test("a shown label names the slider and clicking it focuses the thumb", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Budget", labelled: true, value: 10 });
    await slider.locator(".aster-field-label").click();
    await expect(slider.getByRole("slider", { name: "Budget" })).toBeFocused();
  });

  test("in right-to-left text the horizontal arrows reverse and the fill grows from the right", async ({ page }) => {
    await lab(page);
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    const slider = await add(page, "aster-slider", { label: "Level", labelled: true, value: 50 });
    const thumb = slider.getByRole("slider", { name: "Level" });
    const rail = slider.locator(".aster-slider-rail");
    const r = await box(rail);
    const t = await box(thumb);
    expect(t.x + t.width / 2).toBeGreaterThan(r.x + r.width / 2 - 2);
    expect(t.x + t.width / 2).toBeLessThan(r.x + r.width / 2 + 2);
    await thumb.focus();
    await page.keyboard.press("ArrowLeft");
    expect(await now(thumb)).toBe(51);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await now(thumb)).toBe(49);
    await page.keyboard.press("Home");
    const home = await box(thumb);
    expect(home.x + home.width / 2).toBeGreaterThan(r.x + r.width - 4);
  });

  test("ticks are drawn at the right places and labelled", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Steps", labelled: true, value: 20, step: 20, ticks: true, chrome: { tickLabels: true } });
    await expect(slider.locator(".aster-slider-tick")).toHaveCount(6);
    await expect(slider.locator(".aster-slider-ticks span")).toHaveText(["0", "20", "40", "60", "80", "100"]);
    const rail = await box(slider.locator(".aster-slider-rail"));
    const third = await box(slider.locator(".aster-slider-tick").nth(3));
    expect(Math.abs(third.x + third.width / 2 - (rail.x + rail.width * 0.6))).toBeLessThan(2);
  });
});

test.describe("slider pointer", () => {
  test("dragging moves the thumb, input fires while it moves and change once on release", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Drag", labelled: true, value: 10, step: 10 });
    const thumb = slider.getByRole("slider", { name: "Drag" });
    await dragTo(page, thumb, slider.locator(".aster-slider-rail"), 0.7);
    expect(await now(thumb)).toBe(70);
    const log = await events(page);
    expect(log.filter((e) => e.type === "value-change")).toEqual([{ type: "value-change", detail: { value: 70 } }]);
    expect(log.filter((e) => e.type === "value-input").length).toBeGreaterThan(1);
    expect(log.at(-1)!.type).toBe("value-change");
  });

  test("Escape during a drag puts the thumb back and commits nothing", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Drag", labelled: true, value: 10 });
    const thumb = slider.getByRole("slider", { name: "Drag" });
    await dragTo(page, thumb, slider.locator(".aster-slider-rail"), 0.8, false);
    expect(await now(thumb)).toBe(80);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await now(thumb)).toBe(10);
    expect((await events(page)).filter((e) => e.type === "value-change")).toEqual([]);
  });

  test("a press on the track moves the thumb there", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Jump", labelled: true, value: 0, step: 5 });
    const r = await box(slider.locator(".aster-slider-rail"));
    await page.mouse.click(r.x + r.width * 0.25, r.y + r.height / 2);
    expect(await now(slider.getByRole("slider", { name: "Jump" }))).toBe(25);
    expect((await events(page)).filter((e) => e.type === "value-change")).toEqual([{ type: "value-change", detail: { value: 25 } }]);
  });

  test("dragging past the ends stops at the ends", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Ends", labelled: true, value: 50 });
    const thumb = slider.getByRole("slider", { name: "Ends" });
    await dragTo(page, thumb, slider.locator(".aster-slider-rail"), 1.3);
    expect(await now(thumb)).toBe(100);
    await dragTo(page, thumb, slider.locator(".aster-slider-rail"), -0.05);
    expect(await now(thumb)).toBe(0);
  });
});

test.describe("range slider", () => {
  test("two thumbs are named minimum and maximum and limit each other", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Price", labelled: true, range: true, values: [20, 80], step: 5, minGap: 10 });
    const low = slider.getByRole("slider", { name: "Minimum Price" });
    const high = slider.getByRole("slider", { name: "Maximum Price" });
    await expect(low).toHaveAttribute("aria-valuemax", "70");
    await expect(high).toHaveAttribute("aria-valuemin", "30");
    await low.focus();
    await page.keyboard.press("End");
    expect(await now(low)).toBe(70);
    await page.keyboard.press("ArrowRight");
    expect(await now(low)).toBe(70);
    await high.focus();
    await page.keyboard.press("Home");
    expect(await now(high)).toBe(80);
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    expect(await now(high)).toBe(80);
    await expect(low).toHaveAttribute("aria-valuemax", "70");
    expect((await events(page)).filter((e) => e.type === "value-change").at(-1)!.detail).toEqual({ values: [70, 80] });
  });

  test("dragging one thumb across the other stops at it", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Span", labelled: true, range: true, values: [20, 60] });
    const low = slider.getByRole("slider", { name: "Minimum Span" });
    const high = slider.getByRole("slider", { name: "Maximum Span" });
    await dragTo(page, low, slider.locator(".aster-slider-rail"), 0.95);
    expect(await now(low)).toBe(60);
    expect(await now(high)).toBe(60);
    await dragTo(page, high, slider.locator(".aster-slider-rail"), 0.05);
    expect(await now(high)).toBe(60);
  });

  test("a press on the track moves the nearer thumb", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Span", labelled: true, range: true, values: [20, 80] });
    const r = await box(slider.locator(".aster-slider-rail"));
    await page.mouse.click(r.x + r.width * 0.3, r.y + r.height / 2);
    expect(await now(slider.getByRole("slider", { name: "Minimum Span" }))).toBe(30);
    expect(await now(slider.getByRole("slider", { name: "Maximum Span" }))).toBe(80);
    await page.mouse.click(r.x + r.width * 0.65, r.y + r.height / 2);
    expect(await now(slider.getByRole("slider", { name: "Maximum Span" }))).toBe(65);
  });
});

test.describe("slider paired with number boxes", () => {
  test("dragging updates the box and typing moves the thumb on commit", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Size", labelled: true, value: 20, step: 5, chrome: { input: true } });
    const input = slider.getByRole("textbox", { name: "Size" });
    const thumb = slider.getByRole("slider", { name: "Size" });
    await expect(input).toHaveValue("20");
    await dragTo(page, thumb, slider.locator(".aster-slider-rail"), 0.6);
    await expect(input).toHaveValue("60");
    // The thumb follows what is typed, but nothing is committed until the box is.
    await input.fill("75");
    expect(await now(thumb)).toBe(75);
    expect((await events(page)).filter((e) => e.type === "value-change").map((e) => e.detail)).toEqual([{ value: 60 }]);
    await input.press("Enter");
    expect(await now(thumb)).toBe(75);
    expect((await events(page)).filter((e) => e.type === "value-change").at(-1)!.detail).toEqual({ value: 75 });
  });

  test("a typed value outside the range or off the step is refused with a message and the thumb stays", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Size", labelled: true, value: 20, step: 5, chrome: { input: true } });
    const input = slider.getByRole("textbox", { name: "Size" });
    const thumb = slider.getByRole("slider", { name: "Size" });
    await input.fill("500");
    await input.press("Enter");
    expect(await now(thumb)).toBe(20);
    await expect(slider.getByText(/at most 100/)).toBeVisible();
    await input.fill("22");
    await input.press("Enter");
    expect(await now(thumb)).toBe(20);
    await expect(slider.getByText(/Use increments of 5/)).toBeVisible();
  });

  test("a range has a box for each thumb, and each box is bounded by the other thumb", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Price", labelled: true, range: true, values: [20, 80], chrome: { input: true } });
    const low = slider.getByRole("textbox", { name: "Minimum Price" });
    const high = slider.getByRole("textbox", { name: "Maximum Price" });
    await expect(low).toHaveValue("20");
    await expect(high).toHaveValue("80");
    await high.fill("90");
    await high.press("Enter");
    expect(await now(slider.getByRole("slider", { name: "Maximum Price" }))).toBe(90);
    await low.fill("95");
    await low.press("Enter");
    expect(await now(slider.getByRole("slider", { name: "Minimum Price" }))).toBe(20);
  });
});

/** A mock-backed context and an edit model, built in the page. */
async function bound(page: Page, values: Record<string, unknown>) {
  await page.evaluate(async (values) => {
    const lib = await import("/lib/aster-ui.js" as string);
    const mockLib = await import("/lib/aster-ui-mock.js" as string);
    const json = async (name: string) => (await fetch(`/lib/demo/${name}.json`)).json();
    const mock = await mockLib.createMockService({ metadata: await json("metadata"), data: await json("data"), wasm: new URL("/lib/odata_mock.wasm", location.href) });
    const ctx = await lib.DataContext.connect(mock.transport);
    (window as unknown as { ctx: unknown; model: unknown; lib: unknown }).ctx = ctx;
    (window as unknown as { model: unknown }).model = new lib.EditModel(ctx, "Projects", undefined, values);
    (window as unknown as { lib: unknown }).lib = lib;
  }, values);
}

/** The stored first project, so a change is pending against a baseline and can be reverted. */
async function stored(page: Page) {
  await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const mockLib = await import("/lib/aster-ui-mock.js" as string);
    const json = async (name: string) => (await fetch(`/lib/demo/${name}.json`)).json();
    const mock = await mockLib.createMockService({ metadata: await json("metadata"), data: await json("data"), wasm: new URL("/lib/odata_mock.wasm", location.href) });
    const ctx = await lib.DataContext.connect(mock.transport);
    await ctx.reload("Projects", lib.keyText([1]));
    (window as unknown as { model: unknown }).model = new lib.EditModel(ctx, "Projects", lib.keyText([1]));
  });
}

const modelValue = (page: Page, field: string) => page.evaluate((field) => (window as unknown as { model: { values: { value: Record<string, unknown> } } }).model.values.value[field], field);

test.describe("slider as a form editor", () => {
  test("it writes the field, marks it pending, and Revert puts it back; a decimal field is written as exact text", async ({ page }) => {
    await lab(page);
    await stored(page);
    const slider = await add(page, "aster-slider", { field: "budget", labelled: true, label: "Budget", min: 0, max: 500000, step: 500 });
    await page.evaluate(() => { (document.querySelector("#subject") as unknown as { model: unknown }).model = (window as unknown as { model: unknown }).model; });
    const thumb = slider.getByRole("slider", { name: "Budget" });
    await expect(thumb).toHaveAttribute("aria-valuenow", "42000.59");
    await thumb.focus();
    await page.keyboard.press("ArrowRight");
    expect(await modelValue(page, "budget")).toBe("42500");
    await page.keyboard.press("PageUp");
    expect(await modelValue(page, "budget")).toBe("92500");
    await expect(slider).toHaveAttribute("data-pending", "");
    await slider.getByRole("button", { name: /^Revert Budget/ }).click();
    expect(await modelValue(page, "budget")).toBe("42000.59");
    await expect(thumb).toHaveAttribute("aria-valuenow", "42000.59");
  });

  test("a read-only reason from the model makes it read-only", async ({ page }) => {
    await lab(page);
    await bound(page, { budget: "100" });
    const slider = await add(page, "aster-slider", { field: "budget", labelled: true, label: "Budget", min: 0, max: 200 });
    await page.evaluate(() => {
      const el = document.querySelector("#subject") as unknown as { model: { applyPolicy(p: unknown): void } };
      el.model = (window as unknown as { model: { applyPolicy(p: unknown): void } }).model;
      el.model.applyPolicy({ readOnly: true });
    });
    await expect(slider.getByRole("slider")).toHaveAttribute("aria-readonly", "true");
    await slider.getByRole("slider").focus();
    await page.keyboard.press("ArrowRight");
    expect(await modelValue(page, "budget")).toBe("100");
  });

  test("a form's `control: slider` draws the slider with the field's metadata range", async ({ page }) => {
    await lab(page);
    await bound(page, { behindDays: 3 });
    await page.evaluate(() => {
      const w = window as unknown as { lib: { controlFor(model: unknown, name: string, opts: unknown): unknown; render(v: unknown, el: Element): void; html: unknown }; model: unknown };
      w.lib.render(w.lib.controlFor(w.model, "behindDays", { labelled: true, title: "Behind by (days)", control: "slider" }), document.querySelector("#lab")!);
    });
    await expect(page.locator("#lab aster-slider").getByRole("slider", { name: "Behind by (days)" })).toHaveAttribute("aria-valuenow", "3");
  });

  test("a value outside the range is flagged, not hidden", async ({ page }) => {
    await lab(page);
    const slider = await add(page, "aster-slider", { label: "Level", labelled: true, value: 140 });
    await expect(slider.getByRole("slider", { name: "Level" })).toHaveAttribute("aria-invalid", "true");
    await expect(slider.getByText("Use a value from 0 to 100")).toBeVisible();
  });
});

test.describe("range slider as a between control for the shared filter", () => {
  test("a committed range narrows the collection, the slicer shows a chip, and removing it resets the thumbs", async ({ page }) => {
    await lab(page);
    await bound(page, {});
    await page.evaluate(async () => {
      const w = window as unknown as { lib: any; ctx: any; chips: unknown };
      const { SharedFilters } = w.lib;
      const filters = new SharedFilters(w.ctx.schema);
      const query = filters.query({ set: "Projects", sort: [{ field: "id" }] });
      const collection = w.ctx.collection(query, { pageSize: 500 });
      await collection.ensure(0, 1);
      Object.assign(w, { filters, collection });
      const slider = document.createElement("aster-slider") as any;
      Object.assign(slider, { id: "subject", label: "Budget", labelled: true, range: true, min: 0, max: 500000, step: 10000, values: [0, 500000],
        format: { style: "currency", compact: true }, filter: { filters, by: "budget", field: "budget", set: "Projects" } });
      const slicer = document.createElement("aster-slicer") as any;
      slicer.id = "chips";
      slicer.filters = filters;
      document.querySelector("#lab")!.append(slider, slicer);
    });
    const count = () => page.evaluate(async () => { const c = (window as unknown as { collection: { ensure(a: number, b: number): Promise<void>; count: { value: number } } }).collection; await c.ensure(0, 1); return c.count.value; });
    const slider = page.locator("#subject");
    const slicer = page.locator("#chips");
    expect(await count()).toBe(200);
    await expect(slicer.getByText("None. Showing everything.")).toBeVisible();
    // Dragging narrows the thumb but contributes nothing until release.
    const low = slider.getByRole("slider", { name: "Minimum Budget" });
    await dragTo(page, low, slider.locator(".aster-slider-rail"), 0.4, false);
    expect(await now(low)).toBe(200000);
    await expect(slicer.getByText("None. Showing everything.")).toBeVisible();
    await page.mouse.up();
    const high = slider.getByRole("slider", { name: "Maximum Budget" });
    await high.focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowLeft");
    await expect(high).toHaveAttribute("aria-valuenow", "300000");
    const chip = slicer.getByRole("button", { name: "Remove filter: Budget £200k to £300k" });
    await expect(chip).toBeVisible();
    await expect.poll(count).toBeGreaterThan(0);
    const narrowed = await count();
    expect(narrowed).toBeLessThan(200);
    const expected = await page.evaluate(async () => (await (await fetch("/lib/demo/data.json")).json()).Projects.filter((p: any) => Number(p.budget) >= 200000 && Number(p.budget) <= 300000).length);
    expect(narrowed).toBe(expected);
    // Withdrawing the chip resets the thumbs and the collection.
    await chip.click();
    await expect(low).toHaveAttribute("aria-valuenow", "0");
    await expect(high).toHaveAttribute("aria-valuenow", "500000");
    await expect.poll(count).toBe(200);
    await expect(slicer.getByText("None. Showing everything.")).toBeVisible();
    // A bound at the end of the range is left out: only the lower bound narrows.
    await low.focus();
    await page.keyboard.press("PageUp");
    await expect(slicer.getByRole("button", { name: /Remove filter: Budget from £50k/ })).toBeVisible();
  });
});

test.describe("meter", () => {
  test("it is a native meter with the range and a value text that ends in the state", async ({ page }) => {
    await lab(page);
    const meter = await add(page, "aster-meter", { label: "Spent", value: 9400, min: 0, max: 10000, low: "60%", high: "90%", optimum: 0, format: { style: "currency" }, chrome: { value: "ratio" } });
    const native = meter.getByRole("meter", { name: "Spent" });
    await expect(native).toHaveAttribute("aria-valuetext", "£9,400 of £10,000, Poor");
    await expect(native).toHaveJSProperty("value", 9400);
    await expect(native).toHaveJSProperty("low", 6000);
    await expect(native).toHaveJSProperty("high", 9000);
    await expect(native).toHaveJSProperty("optimum", 0);
    await expect(meter.locator(".aster-meter")).toHaveAttribute("data-state", "poor");
    await expect(meter.locator(".aster-meter-value")).toHaveText("£9,400 of £10,000");
    await meter.evaluate((el: any) => { el.value = 7000; });
    await expect(meter.locator(".aster-meter")).toHaveAttribute("data-state", "suboptimum");
    await meter.evaluate((el: any) => { el.value = 100; });
    await expect(meter.locator(".aster-meter")).toHaveAttribute("data-state", "optimum");
    await expect(native).toHaveAttribute("aria-valuetext", "£100 of £10,000, Good");
  });

  test("the fill is drawn from the value, clamped, and each state has a different mark shape", async ({ page }) => {
    await lab(page);
    const meter = await add(page, "aster-meter", { label: "Used", value: 25, max: 100, optimum: 0, low: 50, high: 75 });
    const track = meter.locator(".aster-meter-track");
    const bar = meter.locator(".aster-meter-bar");
    const width = async () => (await box(bar)).width / (await box(track)).width;
    expect(await width()).toBeCloseTo(0.25, 2);
    await meter.evaluate((el: any) => { el.value = 400; });
    await expect.poll(width).toBeCloseTo(1, 2);
    const shapes = new Set<string>();
    for (const value of [10, 60, 90]) {
      await meter.evaluate((el: any, v: number) => { el.value = v; }, value);
      shapes.add(await meter.locator(".aster-meter-mark svg").innerHTML());
    }
    expect(shapes.size).toBe(3);
  });

  test("bound to a field and another for its limit, it follows edits", async ({ page }) => {
    await lab(page);
    await bound(page, { budget: "10000", spent: "2000" });
    const meter = await add(page, "aster-meter", { field: "spent", maxField: "budget", optimum: 0, low: "60%", high: "90%", format: { style: "currency" }, chrome: { value: "ratio" } });
    await page.evaluate(() => { (document.querySelector("#subject") as any).model = (window as any).model; });
    const native = meter.getByRole("meter", { name: "Spent" });
    await expect(native).toHaveAttribute("aria-valuetext", /^£2,000\.00 of £10,000\.00, Good$/);
    await page.evaluate(() => (window as any).model.set("spent", "9500"));
    await expect(native).toHaveAttribute("aria-valuetext", "£9,500.00 of £10,000.00, Poor");
    // Raising the limit moves the thresholds with it.
    await page.evaluate(() => (window as any).model.set("budget", "20000"));
    await expect(native).toHaveAttribute("aria-valuetext", "£9,500.00 of £20,000.00, Good");
  });

  test("a bound Decimal's scale gives the figure its places and a currency annotation names the currency", async ({ page }) => {
    await lab(page);
    await page.evaluate(async () => {
      const lib = await import("/lib/aster-ui.js" as string);
      const mockLib = await import("/lib/aster-ui-mock.js" as string);
      const json = async (name: string) => (await fetch(`/lib/demo/${name}.json`)).json();
      const metadata = await json("metadata");
      const text = JSON.stringify(metadata);
      const budget = text.match(/"spent":\{[^}]*\}/)![0];
      const patched = JSON.parse(text.replace(budget, budget.replace("{", '{"@Org.OData.Measures.V1.ISOCurrency":"EUR",')));
      const mock = await mockLib.createMockService({ metadata: patched, data: await json("data"), wasm: new URL("/lib/odata_mock.wasm", location.href) });
      const ctx = await lib.DataContext.connect(mock.transport);
      (window as unknown as { model: unknown }).model = new lib.EditModel(ctx, "Projects", undefined, { budget: "10000", spent: "2000" });
    });
    const meter = await add(page, "aster-meter", { field: "spent", maxField: "budget", optimum: 0, format: { style: "currency" }, chrome: { value: "ratio" } });
    await page.evaluate(() => { (document.querySelector("#subject") as any).model = (window as any).model; });
    const slider = await add(page, "aster-slider", { field: "spent", min: 0, max: 20000, step: 500, format: { style: "currency" } }, "pair");
    await page.evaluate(() => { (document.querySelector("#pair") as any).model = (window as any).model; });
    // The annotation is on spent: its figures read in euros with the field's two places.
    await expect(meter.getByRole("meter", { name: "Spent" })).toHaveAttribute("aria-valuetext", /^€2,000\.00 of €10,000\.00, /);
    await expect(slider.getByRole("slider")).toHaveAttribute("aria-valuetext", "€2,000.00");
  });

  test("an empty value says so and chrome can drop the label, the figure and the mark", async ({ page }) => {
    await lab(page);
    const meter = await add(page, "aster-meter", { label: "Reading", value: null });
    await expect(meter.locator(".aster-meter-value")).toHaveText("No value");
    await expect(meter.getByRole("meter", { name: "Reading" })).toHaveAttribute("aria-valuetext", "No value");
    await meter.evaluate((el: any) => { el.value = 0.5; el.chrome = { label: false, value: false }; });
    await expect(meter.locator(".aster-meter-head")).toHaveCount(0);
    await expect(meter.getByRole("meter", { name: "Reading" })).toBeVisible();
  });

  test("custom state words reach the accessible text", async ({ page }) => {
    await lab(page);
    const meter = await add(page, "aster-meter", { label: "Spent", value: 95, max: 100, optimum: 0, low: 60, high: 90, labels: { poor: "Over the limit" } });
    await expect(meter.getByRole("meter")).toHaveAttribute("aria-valuetext", "95 of 100, Over the limit");
  });
});

test("the meter's state agrees with Firefox's own native <meter> for every threshold layout", async ({ page, browserName }) => {
  test.skip(browserName !== "firefox", "Only Firefox exposes the native meter's region to CSS.");
  await lab(page);
  const result = await page.evaluate(async () => {
    const lib = await import("/lib/aster-ui.js" as string);
    const mismatches: string[] = [];
    const lows = [0, 25, 40], highs = [60, 75, 100], optimums = [0, 10, 25, 50, 75, 90, 100];
    for (const low of lows) for (const high of highs) for (const optimum of optimums) for (let value = 0; value <= 100; value += 5) {
      const native = document.createElement("meter");
      Object.assign(native, { min: 0, max: 100, low, high, optimum, value });
      document.querySelector("#lab")!.append(native);
      const theirs = native.matches(":-moz-meter-optimum") ? "optimum" : native.matches(":-moz-meter-sub-optimum") ? "suboptimum" : native.matches(":-moz-meter-sub-sub-optimum") ? "poor" : "unknown";
      native.remove();
      const ours = lib.Meter ? (() => {
        const el = document.createElement("aster-meter") as any;
        Object.assign(el, { value, min: 0, max: 100, low, high, optimum });
        document.querySelector("#lab")!.append(el);
        const state = el.querySelector(".aster-meter")?.getAttribute("data-state");
        el.remove();
        return state;
      })() : "none";
      if (theirs !== ours) mismatches.push(`low ${low} high ${high} optimum ${optimum} value ${value}: native ${theirs}, ours ${ours}`);
    }
    return mismatches;
  });
  expect(result.slice(0, 5)).toEqual([]);
});

test("the fields and layouts example: the meter follows the budget slider and the range slider filters its count", async ({ page }) => {
  await page.goto("/playground/foundations.html");
  const limits = page.locator("#limits");
  // A stored budget off the step grid (42000.59) is not an error in the paired box.
  await expect(limits.getByRole("textbox", { name: "Project budget" })).toHaveValue(/42,?000\.59|£42/);
  await expect(limits.getByRole("alert")).toHaveCount(0);
  const meter = limits.getByRole("meter", { name: "Spent" });
  await expect(meter).toHaveAttribute("aria-valuetext", /Good$/);
  const budget = limits.getByRole("slider", { name: "Project budget" });
  const typed = limits.getByRole("textbox", { name: "Project budget" });
  await typed.fill("10000");
  await typed.press("Enter");
  await expect(meter).toHaveAttribute("aria-valuetext", /Poor$/);
  await budget.focus();
  await page.keyboard.press("End");
  await expect(meter).toHaveAttribute("aria-valuetext", /Good$/);
  const count = page.locator("#between-count");
  await expect(count).toHaveText("200 projects");
  const high = page.locator("#between").getByRole("slider", { name: "Maximum Budget range" });
  await high.focus();
  await page.keyboard.press("Home");
  await expect(page.locator("#between-chips").getByRole("button", { name: /Remove filter: Budget up to/ })).toBeVisible();
  await expect(count).toHaveText("0 projects");
  await page.locator("#between-chips").getByRole("button", { name: /Remove filter/ }).click();
  await expect(count).toHaveText("200 projects");
  await expect(high).toHaveAttribute("aria-valuenow", "500000");
});

for (const theme of ["lamplight", "harbour"]) for (const width of [375, 1000]) {
  test(`${theme} at ${width}px: tick labels never overlap and meter figures never break`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/playground/control-states.html?theme=${theme}&scheme=light`);
    await expect(page.locator("#measures")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const problems: string[] = [];
      for (const row of document.querySelectorAll(".aster-slider-ticks")) {
        const shown = [...row.children].filter((span) => getComputedStyle(span).visibility !== "hidden").map((span) => {
          const range = document.createRange();
          range.selectNodeContents(span);
          const box = range.getBoundingClientRect();
          return { text: span.textContent, left: box.left, right: box.right };
        }).sort((a, b) => a.left - b.left);
        const all = [...row.children].map((span) => span.textContent);
        if (shown[0]?.text !== all[0] || shown.at(-1)?.text !== all.at(-1)) problems.push(`ends dropped in ${all.join(" ")}`);
        for (let i = 1; i < shown.length; i++) if (shown[i]!.left < shown[i - 1]!.right + 2) problems.push(`${shown[i - 1]!.text} touches ${shown[i]!.text}`);
      }
      for (const head of document.querySelectorAll(".aster-meter-head")) {
        for (const part of head.children) if (part.getBoundingClientRect().height > 26) problems.push(`"${part.textContent?.trim()}" wraps`);
      }
      return { problems, rows: document.querySelectorAll(".aster-slider-ticks").length, heads: document.querySelectorAll(".aster-meter-head").length };
    });
    expect(result.rows).toBeGreaterThan(0);
    expect(result.heads).toBeGreaterThan(0);
    expect(result.problems).toEqual([]);
  });
}

test("tick labels thin out in a narrow container, keeping both ends", async ({ page }) => {
  await lab(page);
  await page.evaluate(() => { document.querySelector<HTMLElement>("#lab")!.style.width = "200px"; });
  const slider = await add(page, "aster-slider", { label: "Ticks", labelled: true, value: 30, step: 10, ticks: true, chrome: { tickLabels: true } });
  const labels = slider.locator(".aster-slider-ticks span");
  const shown = async () => labels.evaluateAll((spans) => spans.filter((s) => getComputedStyle(s).visibility !== "hidden").map((s) => {
    const r = document.createRange();
    r.selectNodeContents(s);
    const b = r.getBoundingClientRect();
    return { text: s.textContent, left: b.left, right: b.right };
  }));
  const narrow = await shown();
  expect(narrow.length).toBeLessThan(11);
  expect(narrow[0]!.text).toBe("0");
  expect(narrow.at(-1)!.text).toBe("100");
  for (let i = 1; i < narrow.length; i++) expect(narrow[i]!.left).toBeGreaterThanOrEqual(narrow[i - 1]!.right + 2);
  // Given room again, every label returns.
  await page.evaluate(() => { document.querySelector<HTMLElement>("#lab")!.style.width = "700px"; });
  await expect.poll(async () => (await shown()).length).toBe(11);
});

test("in a narrow card the meter's figure never breaks mid-value: it drops to its own line", async ({ page }) => {
  await lab(page);
  await page.evaluate(() => { document.querySelector<HTMLElement>("#lab")!.style.width = "190px"; });
  const meter = await add(page, "aster-meter", { label: "Within budget", value: 3000, max: 10000, optimum: 0, low: "60%", high: "90%", format: { style: "currency" }, chrome: { value: "ratio" } });
  const label = await box(meter.locator(".aster-meter-label"));
  const figure = await box(meter.locator(".aster-meter-value"));
  expect(label.height).toBeLessThan(26);
  expect(figure.height).toBeLessThan(26);
  expect(figure.y).toBeGreaterThanOrEqual(label.y + label.height - 2);
  await page.evaluate(() => { document.querySelector<HTMLElement>("#lab")!.style.width = "520px"; });
  const wide = await box(meter.locator(".aster-meter-value"));
  const wideLabel = await box(meter.locator(".aster-meter-label"));
  expect(Math.abs(wide.y - wideLabel.y)).toBeLessThan(6);
});
