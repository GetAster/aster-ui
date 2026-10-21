import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { chooseOption } from "./appearance.ts";
import type { Collection, DataContext, Selection } from "@getaster/data";
import type { TileGrid } from "@getaster/elements";

declare global { interface Window { dataViewDemo: { ctx: DataContext; collection: Collection; selection: Selection; grid: TileGrid; requests: { url: string }[] } } }
const cells=(page:Page)=>page.locator("#people .aster-tile[data-key]");
async function open(page:Page) {
  await page.goto("/playground/dataview.html?debug");
  await expect(page.locator("#directory-status")).toContainText("96 colleagues");
  await expect(cells(page).first()).toHaveAccessibleName("Amira Ahmed");
}

test("sorting runs over the whole query and preserves selected membership",async({page})=>{
  await open(page);
  await page.getByRole("button",{name:"Select Amira Ahmed",exact:true}).click();
  await expect(page.locator("#directory-status")).toContainText("1 selected");
  await chooseOption(page,"Sort by","Name: Z to A");
  await expect(cells(page).first()).toHaveAccessibleName("Hugo Lopez");
  expect(await page.evaluate(()=>window.dataViewDemo.selection.keys.peek())).toEqual(["[1]"]);
  await chooseOption(page,"Sort by","Name: A to Z");
  await expect(cells(page).first()).toHaveAccessibleName("Amira Ahmed");
  await expect(cells(page).first()).toHaveAttribute("aria-selected","true");
  await chooseOption(page,"Sort by","Team, then name");
  await expect(cells(page).first()).toHaveAccessibleName("Ben Ahmed");
  await chooseOption(page,"Sort by","Available first");
  await expect(cells(page).first().locator(".directory-availability")).toHaveText("Available");
  expect(await cells(page).count()).toBeLessThan(60);
});

test("case-insensitive search composes with team filters and has an accessible empty state",async({page})=>{
  await open(page);
  const search=page.getByRole("searchbox",{name:"Search people",exact:true});
  await search.fill("engineER");
  await expect(page.locator("#directory-status")).toContainText("24 colleagues");
  await expect(cells(page).first().locator(".directory-team")).toHaveText("Engineering");
  await chooseOption(page,"Team","Design");
  await expect(page.locator("#directory-status")).toContainText("0 colleagues");
  await expect(page.getByRole("grid",{name:"Team directory",exact:true})).toHaveAttribute("tabindex","0");
  await expect(page.locator("#people")).toContainText("No colleagues match your search");
  await search.fill("");
  await expect(page.locator("#directory-status")).toContainText("24 colleagues");
  await expect(cells(page).first().locator(".directory-team")).toHaveText("Design");
});

test("template changes and live updates keep selection, and new colleagues join the query",async({page})=>{
  await open(page);
  const first=cells(page).first();
  await page.getByRole("button",{name:"Select Amira Ahmed",exact:true}).click();
  await page.getByRole("button",{name:"Toggle selected availability",exact:true}).click();
  await expect(first.locator(".directory-availability")).toHaveText("Available");
  await chooseOption(page,"Presentation","Compact cards");
  await expect(page.locator("#people")).toHaveAttribute("data-template","compact");
  await expect(cells(page).first()).toHaveAttribute("aria-selected","true");
  const shape=(await cells(page).first().boundingBox())!;
  expect(shape.width).toBeGreaterThan(shape.height);
  await page.getByRole("button",{name:"Add colleague",exact:true}).click();
  await expect(page.locator("#directory-status")).toContainText("97 colleagues");
  await page.getByRole("button",{name:"Clear selection",exact:true}).click();
  await expect(page.locator("#directory-status")).toContainText("0 selected");
  await page.getByRole("searchbox",{name:"Search people",exact:true}).fill("New colleague");
  await expect(cells(page).first()).toHaveAccessibleName("New colleague 097");
  await expect(page.getByRole("button",{name:"Clear selection",exact:true})).toBeDisabled();
});

test("profile editing writes through the data context and resorts the cards",async({page})=>{
  await open(page);
  await page.getByRole("button",{name:"Open Amira Ahmed",exact:true}).click();
  const profile=page.getByRole("dialog",{name:"Amira Ahmed",exact:true});
  await expect(profile).toBeVisible();
  await profile.getByRole("textbox",{name:"Profile name",exact:true}).fill("Zara Ahmed");
  await profile.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(profile).toHaveCount(0);
  await expect(page.locator("#directory-action")).toHaveText("Updated profile: Zara Ahmed.");
  await chooseOption(page,"Sort by","Name: Z to A");
  await expect(cells(page).first()).toHaveAccessibleName("Zara Ahmed");
  expect(await page.evaluate(()=>window.dataViewDemo.ctx.store.get("People","[1]")?.entity.name)).toBe("Zara Ahmed");
});

test("keyboard navigation, paging and popup focus recovery use the existing tile contract",async({page})=>{
  await open(page);
  await cells(page).first().focus();
  await page.keyboard.press("Space");
  await expect(cells(page).first()).toHaveAttribute("aria-selected","true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog",{name:"Amira Ahmed",exact:true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cells(page).first()).toBeFocused();
  await page.keyboard.press("Control+End");
  await expect(page.getByRole("gridcell",{name:"Hugo Lopez",exact:true})).toBeFocused();
  expect(await cells(page).count()).toBeLessThan(60);
  await page.keyboard.press("F2");
  await expect(page.getByRole("button",{name:"View content of Hugo Lopez",exact:true})).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("gridcell",{name:"Hugo Lopez",exact:true})).toBeFocused();
});

for(const theme of ["lamplight","harbour"])for(const scheme of ["light","dark"]){
  test(`DataView and profile are axe clean: ${theme} ${scheme}`,async({page})=>{
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.goto(`/playground/dataview.html?theme=${theme}&scheme=${scheme}`);
    await expect(page.locator("#directory-status")).toContainText("96 colleagues");
    const check=async()=>{const result=await new AxeBuilder({page}).analyze();expect(result.violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target).join(", ")}`)).toEqual([]);};
    await check();
    await page.getByRole("button",{name:"Open Amira Ahmed",exact:true}).click();
    await expect(page.getByRole("dialog",{name:"Amira Ahmed",exact:true})).toBeVisible();
    await check();
  });
}

test.describe("phone DataView",()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true});
  test("templates fit without overflow and touch controls remain usable",async({page})=>{
    await open(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const select=page.getByRole("button",{name:"Select Amira Ahmed",exact:true});
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await select.tap();
    await expect(page.locator("#directory-status")).toContainText("1 selected");
    await chooseOption(page,"Presentation","Compact cards");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole("button",{name:"Open Amira Ahmed",exact:true}).tap();
    const profile=page.getByRole("dialog",{name:"Amira Ahmed",exact:true});
    await expect(profile).toBeVisible();
    await profile.getByRole("button",{name:"Cancel",exact:true}).tap();
    await expect(profile).toHaveCount(0);
  });
});
