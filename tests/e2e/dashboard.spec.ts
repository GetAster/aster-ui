import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Dashboard, DashboardWidget } from "@getaster/elements";
import type { DataContext, Collection, Selection, PageScope } from "@getaster/data";
import { chooseOption } from "./appearance.ts";

declare global {
  interface Window {
    dashboardDemo: { dashboard: Dashboard; ctx: DataContext; collection: Collection; selection: Selection; scope: PageScope; defaults: DashboardWidget[];
      metrics: { created: Map<string, number>; disposed: Map<string, number>; scopes: Map<string, PageScope> } };
  }
}
const card = (page: Page, id: string) => page.locator(`aster-dashboard-widget[data-widget="${id}"]`);
async function open(page: Page) {
  await page.goto("/playground/dashboard.html?debug");
  await expect(card(page,"summary-1").getByRole("status")).toHaveCount(1);
  await expect(card(page,"summary-1").locator("output")).toHaveText("240");
}

test("shared filters, data mutations, exact totals and selection flow across widget scopes", async ({ page }) => {
  await open(page);
  const summary = card(page,"summary-1").locator("output");
  await card(page,"platforms-1").getByRole("button",{name:"Linux",exact:true}).click();
  await expect(summary).toHaveText("80");
  await expect(card(page,"devices-1").locator(".aster-grid-total")).toContainText("80");
  await page.getByRole("button",{name:"Add Linux device",exact:true}).click();
  await expect(summary).toHaveText("81");
  await expect(card(page,"platforms-1").getByRole("row",{name:"Linux 81",exact:true})).toBeVisible();
  await chooseOption(page,"Summary metric","Monthly cost");
  const old = Number((await summary.textContent())!.replaceAll(",",""));
  const row = card(page,"devices-1").locator(".aster-grid-row[data-key]").first();
  await row.click(); await expect(row).toHaveAttribute("aria-selected","true");
  await page.getByRole("button",{name:"Raise selected costs",exact:true}).click();
  await expect(summary).toHaveText((old+10).toLocaleString("en-GB"));
  const scopes = await page.evaluate(()=>{
    const {metrics,scope}=window.dashboardDemo;
    const values=[...metrics.scopes.values()];
    return { count:values.length, distinct:new Set(values).size, children:values.every(value=>value.parent===scope) };
  });
  expect(scopes).toEqual({count:4,distinct:4,children:true});
});

test("keyboard move/resize preserves content identity, focus and widget sessions", async ({ page }) => {
  await open(page);
  const notes = card(page,"notes-1");
  const input = notes.getByRole("textbox",{name:"Notes text"});
  await input.fill("Keep the exact draft"); await input.evaluate(el=>el.dataset.original="yes");
  const move = notes.getByRole("button",{name:"Move Notes",exact:true});
  await move.focus(); await move.press("ArrowUp");
  await expect.poll(()=>page.locator("aster-dashboard-widget").evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.widget))).toEqual(["summary-1","notes-1","platforms-1","devices-1"]);
  await expect(move).toBeFocused();
  await expect(input).toHaveValue("Keep the exact draft"); await expect(input).toHaveAttribute("data-original","yes");
  const resize=notes.getByRole("button",{name:"Resize Notes",exact:true});
  await resize.focus(); await resize.press("ArrowRight"); await resize.press("ArrowDown");
  await expect(notes).toHaveAttribute("data-width","2"); await expect(notes).toHaveAttribute("data-height","2");
  await expect(resize).toBeFocused();
  expect(await page.evaluate(()=>window.dashboardDemo.metrics.created.get("notes-1"))).toBe(1);
  expect(await page.evaluate(()=>window.dashboardDemo.metrics.disposed.get("notes-1")??0)).toBe(0);
});

test("pointer drop changes DOM reading order and keeps drafts", async ({ page }) => {
  await page.setViewportSize({width:1280,height:1100});
  await open(page);
  const notes=card(page,"notes-1");
  await notes.getByRole("textbox",{name:"Notes text"}).fill("Drag this safely");
  const handle=notes.getByRole("button",{name:"Move Notes",exact:true});
  await handle.scrollIntoViewIfNeeded();
  const start=(await handle.boundingBox())!;
  const target=(await card(page,"summary-1").boundingBox())!;
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2); await page.mouse.down();
  await page.mouse.move(target.x+30,target.y+80,{steps:8}); await page.mouse.up();
  await expect(page.locator("aster-dashboard-widget").first()).toHaveAttribute("data-widget","notes-1");
  await expect(notes.getByRole("textbox",{name:"Notes text"})).toHaveValue("Drag this safely");
});

test("maximize and nested popup Escape restore without replacing content", async ({ page }) => {
  await open(page);
  const summary=card(page,"summary-1");
  await summary.locator("output").evaluate(el=>el.dataset.original="yes");
  await summary.getByRole("button",{name:"Maximize Fleet overview",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Fleet overview",exact:true});
  await expect(dialog).toBeVisible();
  await expect.poll(async()=>Math.round((await dialog.boundingBox())!.width)).toBe(page.viewportSize()!.width-16);
  const choice=dialog.getByRole("combobox",{name:"Summary metric",exact:true});
  await choice.click(); await choice.press("Escape");
  await expect(dialog).toBeVisible(); await expect(choice).toBeFocused();
  await choice.press("Escape"); await expect(page.getByRole("dialog",{name:"Fleet overview",exact:true})).toHaveCount(0);
  await expect(summary.locator("output")).toHaveAttribute("data-original","yes");
  await expect(summary.getByRole("button",{name:"Maximize Fleet overview",exact:true})).toBeFocused();
});

test("dirty removal is guarded, cancellation preserves notes, success disposes exactly once and returns focus", async ({ page }) => {
  await open(page);
  const notes=card(page,"notes-1");
  await notes.getByRole("textbox",{name:"Notes text"}).fill("Important unsaved text");
  await notes.getByRole("button",{name:"Remove Notes",exact:true}).click();
  const confirm=page.getByRole("dialog",{name:"Remove unsaved Notes?",exact:true});
  await expect(confirm).toBeVisible();
  await page.getByRole("button",{name:"Keep widget",exact:true}).click();
  await expect(confirm).not.toBeVisible();
  await expect(notes.getByRole("textbox",{name:"Notes text"})).toHaveValue("Important unsaved text");
  await notes.getByRole("button",{name:"Remove Notes",exact:true}).click();
  await page.getByRole("button",{name:"Discard and remove",exact:true}).click();
  await expect(notes).toHaveCount(0);
  expect(await page.evaluate(()=>window.dashboardDemo.metrics.disposed.get("notes-1"))).toBe(1);
  await expect(card(page,"devices-1").getByRole("button",{name:"Actions for Device fleet",exact:true})).toBeFocused();
});

test("layout restore validates atomically, protects removed drafts and retains config across refresh", async ({ page }) => {
  await open(page);
  await chooseOption(page,"Summary metric","Monthly cost");
  await card(page,"summary-1").getByRole("button",{name:"Resize Fleet overview",exact:true}).press("ArrowDown");
  await page.getByRole("button",{name:"Save layout",exact:true}).click();
  await page.reload();
  await expect(card(page,"summary-1").locator("output")).toHaveText("240");
  await page.getByRole("button",{name:"Restore layout",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"Summary metric",exact:true})).toHaveText("Monthly cost");
  await expect(card(page,"summary-1")).toHaveAttribute("data-height","2");
  const before=await page.evaluate(()=>JSON.stringify(window.dashboardDemo.dashboard.snapshot()));
  const error=await page.evaluate(async()=>{
    const d=window.dashboardDemo.dashboard;
    try {await d.restore({version:1,widgets:[...d.widgets,{...d.widgets[0]!,width:0 as 1}]});return false;} catch {return true;}
  });
  expect(error).toBe(true); expect(await page.evaluate(()=>JSON.stringify(window.dashboardDemo.dashboard.snapshot()))).toBe(before);
  await card(page,"notes-1").getByRole("textbox",{name:"Notes text"}).fill("Keep on cancel");
  await page.evaluate(()=>{void window.dashboardDemo.dashboard.restore({version:1,widgets:[]});});
  await expect(page.getByRole("dialog",{name:"Remove unsaved Notes?",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.dashboardDemo.dashboard.restore({version:1,widgets:[...window.dashboardDemo.dashboard.widgets]}))).toBe(false);
  await page.getByRole("button",{name:"Keep widget",exact:true}).click();
  await expect(page.locator("aster-dashboard-widget")).toHaveCount(4);
  await expect(card(page,"notes-1").getByRole("textbox",{name:"Notes text"})).toHaveValue("Keep on cancel");
});

test("removing the chart withdraws its filter without disposing the shared grid models", async ({ page }) => {
  await open(page);
  await card(page,"platforms-1").getByRole("button",{name:"Linux",exact:true}).click();
  await expect(card(page,"summary-1").locator("output")).toHaveText("80");
  await card(page,"platforms-1").getByRole("button",{name:"Remove Platform mix",exact:true}).click();
  await expect(card(page,"summary-1").locator("output")).toHaveText("240");
  await expect(card(page,"devices-1").locator(".aster-grid-row[data-key]").first()).toBeVisible();
  await page.getByRole("button",{name:"Add Linux device",exact:true}).click();
  await expect(card(page,"summary-1").locator("output")).toHaveText("241");
});

test("unknown saved types retain configuration, and installed factories can recover them", async ({ page }) => {
  await open(page);
  await page.evaluate(async()=>{
    const {dashboard}=window.dashboardDemo;
    await dashboard.restore({version:1,widgets:[...dashboard.widgets,{id:"external",type:"extra",title:"Extra",width:1,height:1,config:{answer:42}}]});
  });
  await expect(card(page,"external")).toContainText("widget type is unavailable");
  await page.evaluate(async()=>{
    const path="/lib/aster-ui.js"; const {html}=await import(path);
    window.dashboardDemo.dashboard.registerType("extra",{create:context=>({render:()=>html`<p>Answer ${context.config.value.answer}</p>`,dispose(){}})});
  });
  await expect(card(page,"external")).toContainText("Answer 42");
});

test("failed factories retry, and late async sessions are disposed without resurrecting removed widgets", async ({ page }) => {
  await open(page);
  await page.evaluate(async()=>{
    const path="/lib/aster-ui.js"; const {html}=await import(path);
    const dashboard=window.dashboardDemo.dashboard;
    let attempts=0;
    dashboard.registerType("retry-test",{create:()=>{if(++attempts===1)throw new Error("Offline");return {render:()=>html`<p>Recovered widget</p>`,dispose(){}};}});
    dashboard.add({id:"retry-test",type:"retry-test",title:"Recovery",width:1,height:1});
  });
  await card(page,"retry-test").getByRole("button",{name:"Retry widget",exact:true}).click();
  await expect(card(page,"retry-test")).toContainText("Recovered widget");
  await page.evaluate(async()=>{
    const path="/lib/aster-ui.js"; const {html}=await import(path);
    const d=window.dashboardDemo.dashboard;
    const state={dispose:0,resolve:()=>{}};
    (window as unknown as {asyncWidget:typeof state}).asyncWidget=state;
    d.registerType("delayed",{create:()=>new Promise(resolve=>{state.resolve=()=>resolve({render:()=>html`<p>Too late</p>`,dispose(){state.dispose++;}});})});
    d.add({id:"delayed",type:"delayed",title:"Delayed",width:1,height:1});
  });
  await expect(card(page,"delayed")).toContainText("Loading widget");
  await page.evaluate(async()=>{
    await window.dashboardDemo.dashboard.removeWidget("delayed");
    (window as unknown as {asyncWidget:{resolve():void}}).asyncWidget.resolve();
  });
  await expect(card(page,"delayed")).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {asyncWidget:{dispose:number}}).asyncWidget.dispose)).toBe(1);
});

test("concurrent guard requests share one decision and rejection keeps the widget usable", async ({ page }) => {
  await open(page);
  await page.evaluate(async()=>{
    const path="/lib/aster-ui.js"; const {html}=await import(path);
    const state={calls:0};
    (window as unknown as {guardState:typeof state}).guardState=state;
    const d=window.dashboardDemo.dashboard;
    d.registerType("guard-test",{create:()=>({render:()=>html`<p>Guarded widget content</p>`,dispose(){},async beforeRemove(){state.calls++;throw new Error("Save failed");}})});
    d.add({id:"layout",type:"guard-test",title:"Guarded",width:1,height:1});
  });
  await expect(card(page,"layout")).toContainText("Guarded widget content");
  const result=await page.evaluate(async()=>{
    const d=window.dashboardDemo.dashboard;
    const first=d.removeWidget("layout");
    const second=d.removeWidget("layout");
    const layout=d.restore({version:1,widgets:[]});
    const outcomes=await Promise.all([first,second,layout]);
    return {outcomes,sameRemoval:first===second,differentLayout:first!==layout};
  });
  expect(result).toEqual({outcomes:[false,false,false],sameRemoval:true,differentLayout:true});
  expect(await page.evaluate(()=>(window as unknown as {guardState:{calls:number}}).guardState.calls)).toBe(1);
  await expect(card(page,"layout")).toContainText("Guarded widget content");
  await expect(page.locator(".aster-dashboard-status")).toContainText("Layout change failed");
});

test("disconnect disposes owned sessions and invalidates a pending removal before reconnect", async ({ page }) => {
  await open(page);
  await page.evaluate(async()=>{
    const path="/lib/aster-ui.js"; const {html}=await import(path);
    const state={calls:0,disposed:0,result:undefined as boolean|undefined,settle:(_value:boolean)=>{}};
    (window as unknown as {lifecycleState:typeof state}).lifecycleState=state;
    const d=window.dashboardDemo.dashboard;
    d.registerType("suspended",{create:()=>({render:()=>html`<p>Retained description</p>`,dispose(){state.disposed++;},beforeRemove(){state.calls++;return new Promise(resolve=>state.settle=resolve);}})});
    d.add({id:"suspended",type:"suspended",title:"Suspended",width:1,height:1});
  });
  await expect(card(page,"suspended")).toContainText("Retained description");
  await page.evaluate(()=>{
    const state=(window as unknown as {lifecycleState:{result:boolean|undefined}}).lifecycleState;
    void window.dashboardDemo.dashboard.removeWidget("suspended").then(result=>state.result=result);
  });
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {lifecycleState:{calls:number}}).lifecycleState.calls)).toBe(1);
  await page.evaluate(()=>{
    const d=window.dashboardDemo.dashboard;
    const parent=d.parentNode!;d.remove();parent.appendChild(d);
    (window as unknown as {lifecycleState:{settle(value:boolean):void}}).lifecycleState.settle(true);
  });
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {lifecycleState:{result:boolean|undefined}}).lifecycleState.result)).toBe(false);
  await expect(card(page,"suspended")).toContainText("Retained description");
  expect(await page.evaluate(()=>(window as unknown as {lifecycleState:{disposed:number}}).lifecycleState.disposed)).toBe(1);
});

test("empty dashboards recover and adding after a saved refresh uses unique IDs", async ({ page }) => {
  await open(page);
  await page.evaluate(()=>window.dashboardDemo.dashboard.restore({version:1,widgets:[]}));
  await expect(page.locator(".aster-dashboard-empty")).toContainText("No widgets yet");
  await chooseOption(page,"Widget type","Notes");
  await page.getByRole("button",{name:"Add widget",exact:true}).click();
  await expect(card(page,"notes-2")).toBeVisible();
  await page.getByRole("button",{name:"Save layout",exact:true}).click();
  await page.reload();
  await expect(card(page,"summary-1").locator("output")).toHaveText("240");
  await page.getByRole("button",{name:"Restore layout",exact:true}).click();
  await expect(card(page,"notes-2")).toBeVisible();
  await chooseOption(page,"Widget type","Notes");
  await page.getByRole("button",{name:"Add widget",exact:true}).click();
  await expect(card(page,"notes-3")).toBeVisible();
  await expect(page.locator("aster-dashboard-widget")).toHaveCount(2);
});

for (const theme of ["lamplight","harbour"]) for (const scheme of ["light","dark"]) {
  test(`dashboard and dirty confirmation are axe clean: ${theme} ${scheme}`, async ({ page }) => {
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.goto(`/playground/dashboard.html?theme=${theme}&scheme=${scheme}`);
    await expect(card(page,"summary-1").locator("output")).toHaveText("240");
    const check=async()=>{const result=await new AxeBuilder({page}).analyze();expect(result.violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target).join(", ")}`)).toEqual([]);};
    await check();
    await card(page,"notes-1").getByRole("textbox",{name:"Notes text"}).fill("Draft");
    await card(page,"notes-1").getByRole("button",{name:"Remove Notes",exact:true}).click();
    await expect(page.getByRole("dialog",{name:"Remove unsaved Notes?",exact:true})).toBeVisible();
    await check();
  });
}

test.describe("dashboard touch",()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true});
  test("stacks without overflow and provides touch alternatives to drag/resize",async({page})=>{
    await open(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const summary=card(page,"summary-1");
    const actions=summary.getByRole("button",{name:"Actions for Fleet overview",exact:true});
    expect((await actions.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await actions.tap();
    await page.getByRole("menuitem",{name:"Taller",exact:true}).tap();
    await expect(summary).toHaveAttribute("data-height","2");
    await summary.getByRole("button",{name:"Maximize Fleet overview",exact:true}).tap();
    await expect(page.getByRole("dialog",{name:"Fleet overview",exact:true})).toBeVisible();
    await summary.getByRole("button",{name:"Restore Fleet overview",exact:true}).tap();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
});
