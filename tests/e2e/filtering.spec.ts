import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
const dialog = (p:Page) => p.getByRole("dialog");
const count = (p:Page) => p.getByRole("region",{name:"Devices summaries"}).locator("dl > div").filter({has:p.locator("dt",{hasText:"Matching devices"})}).locator("dd");
async function open(p:Page){ await p.goto("/playground/filtering.html?debug"); await expect(count(p)).toHaveText("240"); }
async function edit(p:Page){ await p.getByRole("button",{name:"Advanced filter",exact:true}).click(); await expect(dialog(p)).toBeVisible(); }
async function choose(p:Page,label:RegExp,value:string){ await dialog(p).getByRole("combobox",{name:label}).click(); await p.getByRole("option",{name:value,exact:true}).click(); }

test("field types determine the offered query operators", async ({ page }) => {
  await open(page); await edit(page);
  await dialog(page).getByRole("button", { name: "Add condition to Advanced filter", exact: true }).click();
  const operator = dialog(page).getByRole("combobox", { name: /condition 1: test$/ });
  for (const [field, ordered, text] of [["name", false, true], ["cost", true, false], ["online", false, false], ["enrolled", true, false]] as const) {
    await choose(page, /condition 1: field$/, field);
    await operator.click();
    const options = await page.getByRole("listbox", { name: /condition 1: test$/ }).getByRole("option").allTextContents();
    expect(options.includes("greater than"), field).toBe(ordered);
    expect(options.includes("less than"), field).toBe(ordered);
    expect(options.includes("contains"), field).toBe(text);
    expect(options).toContain("equals");
    await operator.press("Escape");
  }
});

test("switching an ordered comparison to text requires a supported operator before Apply", async ({ page }) => {
  await open(page); await edit(page);
  await dialog(page).getByRole("button", { name: "Add condition to Advanced filter", exact: true }).click();
  await choose(page, /condition 1: field$/, "cost");
  await choose(page, /condition 1: test$/, "greater than");
  await dialog(page).getByRole("textbox", { name: /condition 1: value$/ }).fill("5");
  await choose(page, /condition 1: field$/, "name");
  const operator = dialog(page).getByRole("combobox", { name: /condition 1: test$/ });
  await expect(operator).toHaveText("Choose…");
  await expect(dialog(page).getByRole("button", { name: "Apply filter", exact: true })).toBeDisabled();
  await operator.click();
  await expect(page.getByRole("option", { name: "greater than", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "contains", exact: true }).click();
  await dialog(page).getByRole("textbox", { name: /condition 1: value$/ }).fill("Device");
  await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(count(page)).toHaveText("240");
  expect(await page.evaluate(() => (globalThis as any).filterDemo.table.view.criteria)).toEqual({ op: "contains", field: "name", value: "Device" });
});

test("Any conditions offer fields through the empty selector and its arrow", async ({ page }) => {
  await open(page); await edit(page);
  await choose(page, /^Advanced filter: match$/, "Any");
  await dialog(page).getByRole("button", { name: "Add condition to Advanced filter", exact: true }).click();
  const field = dialog(page).getByRole("combobox", { name: /condition 1: field$/ });
  await expect(field).toHaveText("Choose…");
  await field.click();
  await expect(page.getByRole("option", { name: "platform", exact: true })).toBeVisible();
  await field.press("Escape");
  await field.locator("..").locator("svg").click();
  await expect(field).toBeFocused();
  await page.getByRole("option", { name: "platform", exact: true }).click();
  await choose(page, /condition 1: value$/, "Linux");
  await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(count(page)).toHaveText("80");
});

test("keyboard condition editing stays local until Apply; cancel, Escape and clear restore focus",async({page})=>{
  await open(page); await edit(page);
  await dialog(page).getByRole("button",{name:"Add condition to Advanced filter",exact:true}).click();
  const field=dialog(page).getByRole("combobox",{name:/condition 1: field$/});
  await expect(field).toBeFocused();
  await field.press("Enter"); await field.press("ArrowDown"); await field.press("ArrowDown"); await field.press("Enter");
  await expect(field).toHaveText("platform");
  await choose(page, /condition 1: value$/, "Linux");
  await expect(count(page)).toHaveText("240");
  await dialog(page).getByRole("button",{name:"Apply filter",exact:true}).click();
  await expect(dialog(page)).not.toBeVisible(); await expect(count(page)).toHaveText("80");
  await expect(page.getByRole("button",{name:"Advanced filter",exact:true})).toBeFocused();
  await edit(page);
  await choose(page, /condition 1: value$/, "Windows");
  await dialog(page).getByRole("button",{name:"Cancel",exact:true}).click();
  await expect(count(page)).toHaveText("80");
  await edit(page); await page.keyboard.press("Escape"); await expect(dialog(page)).not.toBeVisible();
  await edit(page); await expect(dialog(page).getByRole("combobox",{name:/condition 1: value$/})).toHaveText("Linux");
  await dialog(page).getByRole("button",{name:"Clear expression",exact:true}).click(); await expect(count(page)).toHaveText("80");
  await dialog(page).getByRole("button",{name:"Apply filter",exact:true}).click(); await expect(count(page)).toHaveText("240");
});

test("nested criteria combine with host and column filters and clear only the advanced expression",async({page})=>{
 await open(page); await page.getByRole("checkbox",{name:"Online only"}).check(); await expect(count(page)).toHaveText("120");
 await page.getByRole("button",{name:"Load nested example",exact:true}).click(); await expect(count(page)).toHaveText("80");
 await page.evaluate(()=>{const {table}=(globalThis as any).filterDemo;table.view={...table.view,filters:{platform:{op:"eq",field:"platform",value:"Linux"}}};});
 await expect(count(page)).toHaveText("40");
 await edit(page); await expect(dialog(page).getByLabel("Expression preview")).toContainText(" OR ");
 await dialog(page).getByRole("button",{name:"Clear expression",exact:true}).click(); await dialog(page).getByRole("button",{name:"Apply filter",exact:true}).click();
 await expect(count(page)).toHaveText("40");
 expect(await page.evaluate(()=>{const {table,collection}=(globalThis as any).filterDemo;return {advanced:table.view.criteria??null,filter:collection.query.filter};})).toEqual({advanced:null,filter:{op:"and",args:[{op:"eq",field:"online",value:true},{op:"eq",field:"platform",value:"Linux"}]}});
});

test("invalid saved branches never broaden results and remain repairable",async({page})=>{
 await open(page); await page.getByRole("button",{name:"Load obsolete saved filter"}).click(); await expect(count(page)).toHaveText("0");
 await expect(page.locator(".aster-grid-expression")).toContainText("needs repair"); await edit(page);
 await expect(dialog(page).getByRole("button",{name:"Apply filter",exact:true})).toBeDisabled();
 await expect(dialog(page).getByRole("combobox",{name:/condition 1: field$/})).toContainText("Unavailable: removed");
 await choose(page,/condition 1: field$/,"platform");
 await choose(page, /condition 1: value$/, "Windows");
 await dialog(page).getByRole("button",{name:"Apply filter",exact:true}).click(); await expect(count(page)).toHaveText("160");
});

test("expression survives table/tiles, external sort changes and reconnect without absorbing itself into the base",async({page})=>{
 await open(page); await page.getByRole("button",{name:"Load nested example",exact:true}).click(); await expect(count(page)).toHaveText("160");
 await page.evaluate(()=>{const {collection}=(globalThis as any).filterDemo;collection.setQuery({...collection.query,orderBy:[{field:"name",descending:true}]});});
 await expect(count(page)).toHaveText("160");
 await page.getByRole("combobox",{name:"View",exact:true}).selectOption("tiles"); await expect(page.getByRole("grid",{name:"Device tiles"})).toBeVisible();
 await page.getByRole("combobox",{name:"View",exact:true}).selectOption("table"); await expect(count(page)).toHaveText("160");
 await edit(page); await dialog(page).getByRole("button",{name:"Clear expression",exact:true}).click(); await dialog(page).getByRole("button",{name:"Apply filter",exact:true}).click(); await expect(count(page)).toHaveText("240");
});

test("external query replacement keeps an open draft from applying stale constraints",async({page})=>{
 await open(page); await edit(page); await dialog(page).getByRole("button",{name:"Add condition to Advanced filter",exact:true}).click();
 await page.evaluate(()=>{const {collection}=(globalThis as any).filterDemo;collection.setQuery({set:"Devices",filter:{op:"eq",field:"online",value:true}});});
 await expect(dialog(page)).toContainText("query changed");
 await expect(dialog(page).getByRole("button",{name:"Apply filter",exact:true})).toHaveCount(0);
 await dialog(page).getByRole("button",{name:"Reload current expression"}).click();
 await expect(dialog(page)).not.toContainText("query changed");
 await dialog(page).getByRole("button",{name:"Cancel",exact:true}).click(); await expect(count(page)).toHaveText("120");
});

test("standalone related and symbolic date drafts are usable without a grid",async({page})=>{
 await open(page);
 await page.locator("#builder").getByRole("button",{name:"Apply filter",exact:true}).click();
 await expect(page.locator("#applied")).toContainText('"relative":"today"');
 await expect(page.locator("#applied")).toContainText('"op":"via"');
 expect(await page.evaluate(()=>(globalThis as any).filterDemo.collection.query.filter??null)).toBeNull();
});

test("filter dialog has no serious accessibility violations and stays within a phone viewport in all themes",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"}); await open(page); await page.getByRole("button",{name:"Load nested example",exact:true}).click(); await expect(count(page)).toHaveText("160"); await edit(page);
 const scan=await new AxeBuilder({page}).include(".aster-grid-advanced").analyze();
 expect(scan.violations.filter(v=>v.impact==="serious"||v.impact==="critical")).toEqual([]);
 await page.setViewportSize({width:390,height:844});
 for(const theme of ["lamplight","harbour"]){
   await page.evaluate(t=>{(document.querySelector("#identity") as HTMLLinkElement).href=`../lib/themes/${t}.css`;document.documentElement.dataset.identity=t;},theme);
   expect(await dialog(page).evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
 }
 await page.emulateMedia({forcedColors:"active"});
 await expect(dialog(page).getByRole("button",{name:"Apply filter",exact:true})).toBeVisible();
 await dialog(page).getByRole("button",{name:"Cancel",exact:true}).click();
});


test("saved advanced views restore on reload and new external membership replaces owned controls",async({page})=>{
 await open(page); await page.getByRole("button",{name:"Load nested example",exact:true}).click(); await expect(count(page)).toHaveText("160");
 await page.reload(); await expect(count(page)).toHaveText("160");
 await expect(page.locator(".aster-grid-expression")).toContainText(" OR ");
 await page.getByRole("checkbox",{name:"Online only"}).check(); await expect(count(page)).toHaveText("120");
 expect(await page.evaluate(()=>(globalThis as any).filterDemo.table.view.criteria??null)).toBeNull();
});

test("related and symbolic relative filters reach the server; summaries and CSV share them",async({page})=>{
 await open(page);
 await page.evaluate(()=>{ const {table}=(globalThis as any).filterDemo;table.view={...table.view,criteria:{op:"and",args:[{op:"via",field:"owner",where:{op:"eq",field:"name",value:"Alice"}},{op:"ge",field:"enrolled",value:{relative:"today",days:-7}}]}}; });
 await expect(count(page)).toHaveText("66");
 const result=await page.evaluate(async()=>{const {table,collection,requests}=(globalThis as any).filterDemo;return{csv:await table.exportCsv(),criteria:table.view.criteria,query:collection.query,urls:requests.map((r:any)=>decodeURIComponent(r.url))};});
 expect(result.csv.trim().split("\r\n")).toHaveLength(67);
 expect(result.criteria.args[1].value).toEqual({relative:"today",days:-7});
 expect(result.urls.some((u:string)=>u.includes("owner/name eq 'Alice'")&&u.includes("2026-10-12"))).toBe(true);
});

test("an invalid inline row prevents applying a filter and retains the expression draft",async({page})=>{
 await open(page); await page.getByRole("button",{name:"Load nested example",exact:true}).click(); await expect(count(page)).toHaveText("160");
 await page.evaluate(()=>{(globalThis as any).filterDemo.table.editable=true;});
 const row=page.locator('.aster-grid-row[data-key="[1]"]');
 await row.locator('[aria-colindex="4"]').dblclick(); await row.locator("input").nth(3).fill("bad");
 await edit(page); await dialog(page).getByRole("button",{name:"Clear expression",exact:true}).click();
 await dialog(page).getByRole("button",{name:"Apply filter",exact:true}).click();
 await expect(dialog(page)).toContainText("could not be saved"); await expect(count(page)).toHaveText("160");
 await dialog(page).getByRole("button",{name:"Cancel",exact:true}).click();
 await expect(row.locator('input[aria-invalid="true"]')).toHaveValue("bad");
});


test("filter controls retain accessibility in every identity and colour scheme",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"}); await open(page); await page.getByRole("button",{name:"Load nested example",exact:true}).click(); await expect(count(page)).toHaveText("160"); await edit(page);
 for(const theme of ["lamplight","harbour"]) for(const scheme of ["light","dark"]){
   await page.evaluate(({theme,scheme})=>{(document.querySelector("#identity") as HTMLLinkElement).href=`../lib/themes/${theme}.css`;document.documentElement.dataset.identity=theme;document.documentElement.dataset.scheme=scheme;document.documentElement.style.colorScheme=scheme;},{theme,scheme});
   await expect.poll(()=>page.evaluate(()=>document.querySelector<HTMLLinkElement>("#identity")?.sheet!==null)).toBe(true);
   const scan=await new AxeBuilder({page}).include(".aster-grid-advanced").analyze();
   expect(scan.violations.filter(v=>v.impact==="serious"||v.impact==="critical"),`${theme} ${scheme}`).toEqual([]);
 }
});


test("typed lists and custom relative offsets use labeled controls and preserve editable text",async({page})=>{
 await open(page);
 const builder=page.locator("#builder");
 await page.evaluate(()=>{(globalThis as any).filterDemo.builder.model.reset({op:"in",field:"cost",values:["10.10"]});});
 const values=builder.getByRole("textbox",{name:/values, one per line/});
 await values.fill("10.10\n20.20");
 await builder.getByRole("button",{name:"Apply filter",exact:true}).click();
 await expect(page.locator("#applied")).toContainText('"values":["10.10","20.20"]');
 await page.evaluate(()=>{(globalThis as any).filterDemo.builder.model.reset({op:"ge",field:"enrolled",value:{relative:"today",days:-7}});});
 const days=builder.getByRole("spinbutton",{name:/offset days$/});
 await days.fill("-1");
 await expect(days).toBeFocused();
 await builder.getByRole("button",{name:"Apply filter",exact:true}).click();
 await expect(page.locator("#applied")).toContainText('"days":-1');
 const scan=await new AxeBuilder({page}).include("#builder").analyze();
 expect(scan.violations.filter(v=>v.impact==="serious"||v.impact==="critical")).toEqual([]);
});


test("platform membership uses the infomodel multi-choice control and keeps its selections across editing", async ({ page }) => {
  await open(page); await edit(page);
  await dialog(page).getByRole("button", { name: "Add condition to Advanced filter", exact: true }).click();
  await choose(page, /condition 1: field$/, "platform");
  await expect(dialog(page).getByRole("button", { name: "Apply filter", exact: true })).toBeDisabled();
  await choose(page, /condition 1: value$/, "Linux");
  await choose(page, /condition 1: test$/, "is one of");
  const values = dialog(page).getByRole("group", { name: "Advanced filter, condition 1: values", exact: true });
  await expect(values.getByRole("checkbox", { name: "Linux", exact: true })).toBeChecked();
  await expect(values.getByRole("checkbox", { name: "macOS", exact: true })).toBeVisible();
  await values.getByRole("checkbox", { name: "Windows", exact: true }).check();
  await expect(dialog(page).getByRole("textbox")).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(count(page)).toHaveText("160");
  await edit(page);
  await expect(values.getByRole("checkbox", { name: "Linux", exact: true })).toBeChecked();
  await expect(values.getByRole("checkbox", { name: "Windows", exact: true })).toBeChecked();
  await values.getByRole("checkbox", { name: "Linux", exact: true }).uncheck();
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(count(page)).toHaveText("160");
  await edit(page);
  await values.getByRole("checkbox", { name: "Linux", exact: true }).uncheck();
  await choose(page, /condition 1: test$/, "equals");
  await expect(dialog(page).getByRole("combobox", { name: /condition 1: value$/ })).toHaveText("Windows");
  await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(count(page)).toHaveText("80");
});

test("basic clauses reveal only relevant controls; advanced comparisons remain available", async ({ page }) => {
  await open(page); await edit(page);
  await dialog(page).getByRole("button", { name: "Add condition to Advanced filter", exact: true }).click();
  await expect(dialog(page).locator('[aria-invalid="true"]')).toHaveCount(0);
  await expect(dialog(page).getByRole("textbox")).toHaveCount(0);
  await choose(page, /condition 1: field$/, "cost");
  await expect(dialog(page).getByRole("combobox", { name: /compare with$/ })).toHaveCount(0);
  await dialog(page).getByText("Compare with…", { exact: true }).click();
  await choose(page, /condition 1: compare with$/, "Another field");
  await expect(dialog(page).getByRole("combobox", { name: /condition 1: comparison field$/ })).toBeFocused();
  await choose(page, /condition 1: comparison field$/, "limit");
  await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(count(page)).toHaveText("0");
});


test("unavailable selected choices remain visible for repair and boolean lists stay typed", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { const { table } = (globalThis as any).filterDemo; table.view = { ...table.view, criteria: { op: "in", field: "platform", values: ["Linux", "Solaris"] } }; });
  await expect(count(page)).toHaveText("0");
  await edit(page);
  await expect(dialog(page).getByRole("button", { name: "Apply filter", exact: true })).toBeDisabled();
  await dialog(page).getByRole("checkbox", { name: "Unavailable: Solaris", exact: true }).click();
  await expect(dialog(page).getByRole("checkbox", { name: "Unavailable: Solaris", exact: true })).toHaveCount(0);
  await expect(dialog(page).getByRole("checkbox", { name: "Linux", exact: true })).toBeFocused();
  await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(count(page)).toHaveText("80");
  await edit(page);
  await choose(page, /condition 1: field$/, "online");
  await dialog(page).getByRole("checkbox", { name: "Yes", exact: true }).check();
  await dialog(page).getByRole("checkbox", { name: "Unavailable: Linux", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(count(page)).toHaveText("120");
  expect(await page.evaluate(() => (globalThis as any).filterDemo.table.view.criteria)).toEqual({ op: "in", field: "online", values: [true] });
});

test.describe("membership by touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("finite values use touch-sized labels and keep options inside a narrow dialog", async ({ page }) => {
    await open(page); await edit(page);
    await dialog(page).getByRole("button", { name: "Add condition to Advanced filter", exact: true }).tap();
    await choose(page, /condition 1: field$/, "platform");
    await choose(page, /condition 1: test$/, "is one of");
    const linux = dialog(page).getByRole("checkbox", { name: "Linux", exact: true });
    await linux.locator("..").tap();
    await expect(linux).toBeChecked();
    expect((await linux.locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await dialog(page).evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    const scan = await new AxeBuilder({ page }).include(".aster-grid-advanced").analyze();
    expect(scan.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).tap();
    await expect(count(page)).toHaveText("80");
  });
});


test("the reporting grid uses the same metadata-backed platform choices", async ({ page }) => {
  await page.goto("/playground/reporting.html?debug");
  await expect(page.locator(".aster-grid-total")).toContainText("240");
  await edit(page);
  await dialog(page).getByRole("button", { name: "Add condition to Advanced filter", exact: true }).click();
  await choose(page, /condition 1: field$/, "platform");
  await choose(page, /condition 1: test$/, "is one of");
  await dialog(page).getByRole("checkbox", { name: "macOS", exact: true }).check();
  await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(page.locator(".aster-grid-total")).toContainText("80");
});

test("free-form lists keep multiline values, labels and null controls in separate space", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page); await edit(page);
  await dialog(page).getByRole('button', { name: 'Add condition to Advanced filter', exact: true }).click();
  await choose(page, /condition 1: field$/, 'name');
  await choose(page, /condition 1: test$/, 'is one of');
  const values = dialog(page).getByRole('textbox', { name: /values, one per line/ });
  await values.fill('Device 001\nDevice 002\nDevice 003');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const area = await values.boundingBox();
    const frame = await values.locator('..').boundingBox();
    const label = await values.locator('..').locator('span').boundingBox();
    const nulls = await dialog(page).getByLabel('Include empty (null) values').boundingBox();
    expect(area!.y).toBeGreaterThanOrEqual(label!.y + label!.height);
    expect(area!.y + area!.height).toBeLessThanOrEqual(frame!.y + frame!.height);
    expect(nulls!.y).toBeGreaterThanOrEqual(frame!.y + frame!.height);
  }
  expect((await new AxeBuilder({ page }).include('.aster-grid-advanced').analyze()).violations).toEqual([]);
});


for (const [field, exactValues] of [
  ["serial", ["9007199254740992", "9007199254740993"]],
  ["exactAmount", ["123456789012345678.1234567890", "123456789012345678.1234567891"]],
] as const) {
  test(`${field} multiline membership preserves exact numbers through draft, query and editing`, async ({ page }) => {
    await open(page); await edit(page);
    await dialog(page).getByRole("button", { name: "Add condition to Advanced filter", exact: true }).click();
    await choose(page, /condition 1: field$/, field);
    await choose(page, /condition 1: test$/, "is one of");
    const values = dialog(page).getByRole("textbox", { name: /values, one per line/ });
    await values.fill(exactValues.join("\n"));
    const criteria = { op: "in", field, values: [...exactValues] };
    expect(await dialog(page).locator("aster-filter-builder").evaluate((builder: any) => builder.model.result.value.criteria)).toEqual(criteria);
    await expect(count(page)).toHaveText("240");
    await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
    await expect(count(page)).toHaveText("2");
    const applied = await page.evaluate(() => {
      const { table, collection, requests } = (globalThis as any).filterDemo;
      return { criteria: table.view.criteria, filter: collection.query.filter,
        filters: requests.map((r: any) => new URL(r.url, location.href).searchParams.get("$filter")) };
    });
    expect(applied.criteria).toEqual(criteria);
    expect(applied.filter).toEqual(criteria);
    expect(applied.filters).toContain(`${field} in (${exactValues.join(",")})`);
    await edit(page);
    await expect(values).toHaveValue(exactValues.join("\n"));
    await dialog(page).getByLabel("Include empty (null) values").check();
    expect(await dialog(page).locator("aster-filter-builder").evaluate((builder: any) => builder.model.result.value.criteria)).toEqual({ ...criteria, values: [...exactValues, null] });
    await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
    await expect(count(page)).toHaveText("3");
    await edit(page);
    await expect(values).toHaveValue(exactValues.join("\n"));
    await expect(dialog(page).getByLabel("Include empty (null) values")).toBeChecked();
    await values.fill(exactValues[1]);
    await dialog(page).getByLabel("Include empty (null) values").uncheck();
    await dialog(page).getByRole("button", { name: "Apply filter", exact: true }).click();
    await expect(count(page)).toHaveText("1");
    expect(await page.evaluate(() => (globalThis as any).filterDemo.collection.query.filter)).toEqual({ op: "in", field, values: [exactValues[1]] });
  });
}
