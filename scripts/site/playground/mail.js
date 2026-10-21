import { Authentication, AuthenticationError, DataContext, Composite, asterComponents, compositeTypes as t, defineCompositeRegistry, defineCompositeRenderer, defineElement, elementProperty, effect, html, signal, sidebarItems } from "../lib/aster-ui.js";
import { createMockService } from "../lib/aster-ui-mock.js";
import { mailWorkspaceType, friendlyError, validRecipient } from "./mail-model.js";

const $ = selector => document.querySelector(selector);
function receivedText(value) {
  if (value === null || value === undefined) return "";
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
const icon = path => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${path}/></svg>`;
const loginDialog = $("#login");
let expired = false, loginCount = 0;
const feedback = signal();

// The application owns its login interaction; Authentication owns the waiting requests.
function recover({ signal }) {
  loginCount++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort); loginDialog.removeEventListener("close", cancel);
      loginDialog.close();
      if (error) reject(error);
      else { expired = false; resolve(); }
    };
    const cancel = () => finish(new AuthenticationError("cancelled"));
    const abort = () => finish(signal.reason);
    const signedIn = () => finish();
    const show = method => {
      loginDialog.content = html`<div class="mail-auth"><aside class="mail-auth-brand"><img src="../docs-assets/aster-logo.svg" alt="Aster" width="112" height="40"><strong>Return to<br>your mail.</strong><p>Your open messages and unsent drafts stay where you left them.</p></aside>
        <section class="mail-auth-form"><p class="mail-eyebrow">YOUR ASTER ACCOUNT</p><h2 id="login-title">${method ? `Continue with ${method}` : "Sign in to continue"}</h2>
        <p>Your session expired. Continue as <strong>alex@example.test</strong> to finish the waiting operation.</p>
        ${method ? html`<p class="mail-auth-preview">Demo only. ${method === "email" ? "No email has been sent." : method === "a passkey" ? "No browser passkey prompt has been opened." : "No identity provider has been contacted."} Use the button below to simulate a successful sign-in.</p>
          <button class="aster-button" data-complete-login @click=${signedIn}>Simulate successful sign-in</button><div class="mail-auth-links"><button class="aster-button" @click=${() => show()}>Other sign-in options</button></div>`
        : html`<div class="mail-auth-options"><button class="aster-button" @click=${() => show("a passkey")}>${icon("M14 9a5 5 0 1 0-4 5l8 8 3-3-2-2 2-2-3-3")}<span>Sign in with a passkey</span></button>
          <button class="aster-button" @click=${() => show("email")}>${icon("M3 5h18v14H3zM3 6l9 7 9-7")}<span>Continue with email</span></button>
          <button class="aster-button" @click=${() => show("your organisation")}>${icon("M5 21V3h14v18M9 7h2m2 0h2M9 11h2m2 0h2M10 21v-6h4v6")}<span>Sign in with SSO</span></button></div><p class="mail-auth-preview">Local simulation. These choices demonstrate where your own login flow connects.</p>`}
        <div class="mail-auth-links"><button class="aster-button" @click=${cancel}>Cancel sign-in</button><button class="aster-button" @click=${() => finish(new AuthenticationError("failed"))}>Simulate failure</button></div></section></div>`;
      if (loginDialog.open) queueMicrotask(() => loginDialog.querySelector("[data-complete-login],.mail-auth-options button")?.focus());
    };
    loginDialog.labelledBy = "login-title"; show();
    loginDialog.addEventListener("close", cancel);
    signal.addEventListener("abort", abort, { once: true });
    queueMicrotask(() => { if (signal.aborted) abort(); else if (!settled) loginDialog.show(); });
  });
}

const auth = new Authentication({
  identity: () => "example-tenant/alex@example.test", recover,
  // This mock rejects every expired-session request before applying any operation.
  replay: ({ response }) => response.status === 401,
});
const metadata = { $Version: "4.01", $EntityContainer: "Mail.Container", $Reference: { "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json": { $Include: [{ $Namespace: "Org.OData.Core.V1", $Alias: "Core" }] } }, Mail: {
  Message: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, senderAddress: {}, sender: { "@Org.OData.Core.V1.Description": "From" }, recipient: { "@Org.OData.Core.V1.Description": "To" }, subject: { "@Org.OData.Core.V1.Description": "Subject" }, body: { "@Org.OData.Core.V1.Description": "Message" }, folder: { "@Org.OData.Core.V1.Description": "Folder" }, unread: { $Type: "Edm.Boolean", "@Org.OData.Core.V1.Description": "Unread" }, date: { $Type: "Edm.DateTimeOffset", "@Org.OData.Core.V1.Description": "Received" } },
  Container: { $Kind: "EntityContainer", Messages: { $Collection: true, $Type: "Mail.Message" } },
} };
const subjects = ["Friday's launch checklist", "Design review — reading pane", "A few notes from our customer call", "Team lunch next week", "Updated project timeline", "Welcome to the workspace"];
const senders = ["Priya Shah", "James Chen", "Maya Wilson", "Oliver Brown", "Sofia Patel", "Aster team"];
const data = { Messages: Array.from({ length: 64 }, (_, i) => ({ id: i + 1, sender: senders[i % 6], senderAddress: `${senders[i % 6].toLowerCase().replaceAll(" ", ".")}@example.test`, recipient: "alex@example.test", subject: subjects[i % 6] + (i > 5 ? ` · ${Math.floor(i / 6) + 1}` : ""),
  body: `Hi Alex,\n\n${["The checklist is ready for your review. Could you take a look at the final items before Friday?", "I've attached my thoughts on the new reading pane. Keeping drafts open while switching folders makes this much easier to use.", "We had a useful conversation about how the team works. I'll share a summary at our next meeting."][i % 3]}\n\nThanks,\n${senders[i % 6]}`,
  folder: i < 48 ? "Inbox" : i < 56 ? "Sent" : "Archive", unread: i % 3 === 0 && i < 48, date: new Date(Date.now() - (63 - i) * 2 * 60 * 60 * 1000).toISOString() })) };

let instance;
const MailPanel = defineElement({ tag: "aster-mail-panel", properties: { session: elementProperty(t.custom("mail session", value => !!value?.id), () => ({ id: "welcome" })) },
  render: ({ session }) => {
    switch (session.kind) {
      case "preview":
      case "message": {
        const record = session.kind === "preview" ? session.record.value : session.record;
        if (!record) return html`<section class="mail-welcome"><p class="mail-eyebrow">YOUR MAIL</p><h2>Select a message to read.</h2><p>Double-click a message or press Enter to open it in its own tab. Your drafts stay open while you browse.</p></section>`;
        return html`<article class="mail-message"><header><div class="mail-avatar" aria-hidden="true">${record.sender.split(" ").map(part => part[0]).slice(0, 2).join("").toUpperCase()}</div><div><h2>${record.subject}</h2><p class="mail-meta"><strong>${record.sender}</strong><br>To: ${record.recipient} · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.date))}</p></div></header><p class="mail-body">${record.body}</p><button class="aster-button" @click=${() => instance.model.reply(record)}>Reply</button></article>`;
      }
      case "draft": {
        const update = (field, value) => { session[field].value = value; session.dirty.value = true; };
        return html`<section class="mail-draft" aria-label="Compose message" aria-busy=${String(session.busy.value)}><h2>New message</h2>
          ${session.error.value ? html`<section class="mail-draft-error"><div role="status" aria-atomic="true"><h3 tabindex="-1">Message wasn’t sent</h3><p>${session.error.value}</p></div><div class="mail-feedback-actions"><button class="aster-button" ?disabled=${!instance.commands.send.enabled.value} @click=${() => { void instance.commands.send.execute().catch(() => {}); }}>Try sending again</button><button class="aster-button" @click=${event => { const panel = event.currentTarget.closest(".mail-draft"); session.error.value = ""; queueMicrotask(() => panel.querySelector("textarea")?.focus()); }}>Dismiss</button></div></section>` : ""}
          <label>To<input type="email" autocomplete="email" .value=${session.to.value} aria-invalid=${String(!!session.to.value && !validRecipient(session.to.value))} aria-describedby=${`${session.id}-recipient-help`} ?disabled=${session.busy.value} @input=${e => update("to", e.target.value)}></label><small id=${`${session.id}-recipient-help`} class="mail-validation" ?hidden=${!session.to.value || validRecipient(session.to.value)}>Enter an email address such as name@example.com.</small>
          <label>Subject<input .value=${session.subject.value} ?disabled=${session.busy.value} @input=${e => update("subject", e.target.value)}></label>
          <label>Message<textarea .value=${session.body.value} ?disabled=${session.busy.value} @input=${e => update("body", e.target.value)}></textarea></label>
          <aster-progress-status .busy=${session.busy.value} .error=${undefined} .pendingText=${"Sending message…"} .completeText=${""}></aster-progress-status>

          <p class="mail-meta">${session.dirty.value ? "Unsaved draft · retained while you switch tabs" : "Enter a recipient, subject and message, then use Send message above."}</p></section>`;
      }
      default: return html`<section class="mail-welcome"><h2>Select a message to read.</h2><p>Open a message or start a new draft.</p></section>`;
    }
  },
});
void MailPanel;

try {
  const mock = await createMockService({ metadata, data, wasm: new URL("../lib/odata_mock.wasm", import.meta.url) });
  const calls = [];
  const transport = auth.wrap(async request => {
    calls.push({ method: request.method, url: request.url, expired });
    if (expired) return { status: 401, headers: { "www-authenticate": 'Bearer realm="mail", error="invalid_token"' }, body: JSON.stringify({ error: { code: "SessionExpired", message: "Sign in to continue." } }) };
    return mock.transport(request);
  });
  const ctx = await DataContext.connect(transport);
  const folders = signal(["Inbox", "Sent", "Archive"].map(id => ({ id, label: id, icon: id === "Inbox" ? "↓" : id === "Sent" ? "↗" : "▤" })));
  async function refreshCounts() {
    const rows = await ctx.source.aggregate("Messages", { filter: { op: "eq", field: "unread", value: true }, groupBy: ["folder"] });
    folders.value = folders.peek().map(item => ({ ...item, badge: String(rows.find(row => row.folder === item.id)?.count ?? 0) }));
  }
  async function confirmDiscard(signal) {
    const dialog = $("#discard");
    if (dialog.open || signal.aborted) return false;
    return new Promise(resolve => {
      let discard = false;
      dialog.labelledBy = "discard-title";
      dialog.content = html`<h2 id="discard-title">Discard this draft?</h2><p>Your unsent message will be removed.</p><div class="mail-confirm-actions"><button class="aster-button" @click=${() => dialog.close()}>Keep editing</button><button class="aster-button" @click=${() => { discard = true; dialog.close(); }}>Discard draft</button></div>`;
      const finish = () => {
        signal.removeEventListener("abort", abort); dialog.removeEventListener("close", finish);
        resolve(!signal.aborted && discard);
      };
      const abort = () => { dialog.close(); finish(); };
      dialog.addEventListener("close", finish, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      queueMicrotask(() => { if (!signal.aborted) dialog.show(); else finish(); });
    });
  }
  const authoring = defineCompositeRegistry({ inputs: { ctx: t.instance(DataContext), folders: t.signal(sidebarItems), refreshCounts: t.custom("refresh function", value => typeof value === "function"), sessionRegistry: t.custom("session component registry", value => typeof value?.component === "function") },
    models: { "mail-workspace": mailWorkspaceType }, components: { Sidebar: asterComponents.Sidebar, Grid: asterComponents.Grid, Tabs: asterComponents.Tabs, CommandBar: asterComponents.CommandBar,
      MailPanel: { props: { session: t.custom("mail session", value => !!value?.id) },
        create: ({ props }) => {
          const element = document.createElement("aster-mail-panel"); element.session = props.session;
          return { element, canClose: async signal => {
            const session = props.session;
            if (session.busy?.peek()) return false;
            const accepted = !session.dirty.peek() || await confirmDiscard(signal);
            return accepted && !signal.aborted && !session.busy?.peek();
          } };
        } },
    },
    renderers: {
      "mail-date": defineCompositeRenderer(["formatters"], receivedText),
      "mail-sender": defineCompositeRenderer(["renderers"], record => html`<span class=${record.unread ? "mail-sender mail-unread" : "mail-sender"}>${record.unread ? html`<span class="mail-unread-dot" aria-hidden="true"></span><span class="aster-sr-only">Unread </span>` : ""}${record.sender}</span>`),
      "mail-subject": defineCompositeRenderer(["renderers"], record => html`<div class="mail-subject"><span class=${record.unread ? "mail-unread" : ""}>${record.subject}</span><small>${record.body.split("\n").filter(line => line.trim())[1] ?? ""}</small></div>`),
      "mail-panel": defineCompositeRenderer(["renderPanel"], item => item.value === "welcome"
        ? html`<aster-mail-panel .session=${{ id: "welcome", kind: "preview", record: instance.model.selection.selected }}></aster-mail-panel>`
        : html`${instance.model.panels.get(item.value)?.value.value?.element ?? ""}`) } });
  const response = await fetch("./mail.ui.json");
  if (!response.ok) throw new Error("Mail workspace definition unavailable.");
  const { definition: raw, sources } = await response.json();
  const definition = authoring.validate(raw, sources);
  const placement = authoring.placement(definition, place => html`<div class="mail-layout"><aside class="mail-folders"><h2>Favourites</h2>${place("folders")}</aside><div class="mail-actions">${place("actions")}</div><section class="mail-list" aria-label="Message list">${place("messages")}</section><section class="mail-reader" aria-label="Reading pane">${place("reading")}</section></div>`);
  // The Tabs renderer runs during mounting; resolve the owner after model creation.
  const host = $("#mail");
  instance = new Composite(definition, authoring.registry, { ctx, inputs: { ctx, folders, refreshCounts, sessionRegistry: authoring.registry }, sources, placement });
  instance.mount(host);
  await Promise.all(Object.values(instance.children).map(child => child.ensure()));
  const model = instance.model;
  const stop = effect(() => { $("#notice").textContent = model.notice.value; $("#auth-progress").busy = auth.recovering.value;  });
  $("#auth-progress").pendingText = "Waiting for sign-in…"; $("#auth-progress").completeText = "";
  host.querySelector("aster-sidebar").addEventListener("navigate", event => { event.preventDefault(); model.selection.clear(); model.folder.value = event.detail; });
  const grid = host.querySelector("aster-grid");
  grid.addEventListener("row-open", event => {
    event.preventDefault();
    const record = ctx.store.get("Messages", event.detail.key)?.entity;
    model.open(record);
    queueMicrotask(() => host.querySelector('[role="tab"][aria-selected="true"]')?.focus());
  });
  grid.addEventListener("click", event => {
    if (event.target.closest('[role="row"][data-key]') && !event.target.closest('button, input, select, textarea, a[href]')) model.active.value = "welcome";
  });
  const tabs = host.querySelector("aster-tabs");
  tabs.addEventListener("change", event => { if (event.target === tabs) model.active.value = event.detail; });
  tabs.addEventListener("close", event => { if (event.target === tabs) void model.close(event.detail); });
  $("#search").addEventListener("input", event => { model.search.value = event.target.value; });
  function report(error, title, retry) {
    if (error instanceof AuthenticationError) $("#background").checked = false;
    model.notice.value = "";
    feedback.value = { title, detail: friendlyError(error), retry };
  }
  const run = async (action, title = "Mail couldn’t update") => {
    feedback.value = undefined;
    try { await action(); } catch (error) { report(error, title, () => run(action, title)); }
  };
  const commandStops = Object.entries(instance.commands).map(([name, cmd]) => effect(() => {
    const error = cmd.error.value;
    if (name === "send") {
      if (error) { model.notice.value = ""; requestAnimationFrame(() => { const heading = host.querySelector('[role="tabpanel"]:not([hidden]) .mail-draft-error h3'); heading?.scrollIntoView({ block: "nearest", behavior: "instant" }); heading?.focus({ preventScroll: true }); }); }
      return;
    }
    if (cmd.busy.value) feedback.value = undefined;
    if (error) report(error, ({ refresh: "Mail couldn’t refresh", read: "Messages weren’t marked as read", open: "Message couldn’t open" })[name] ?? "Mail couldn’t update", () => run(() => cmd.execute(), ({ refresh: "Mail couldn’t refresh", read: "Messages weren’t marked as read", open: "Message couldn’t open" })[name] ?? "Mail couldn’t update"));
  }));
  const stopFeedback = effect(() => {
    const item = feedback.value;
    $("#feedback").hidden = !item;
    $("#feedback-title").textContent = item?.title ?? "";
    $("#feedback-detail").textContent = item?.detail ?? "";
  });
  $("#dismiss").addEventListener("click", () => { feedback.value = undefined; host.querySelector("aster-grid")?.focus(); });
  $("#retry").addEventListener("click", () => { void feedback.peek()?.retry(); });
  $("#expire").addEventListener("click", event => { event.currentTarget.focus(); expired = true; void run(() => instance.commands.refresh.execute(), "Mail couldn’t refresh"); });
  $("#expire-only").addEventListener("click", () => { expired = true; model.notice.value = "Session expired. Your next data operation will ask you to sign in."; });
  let arrival = 1;
  $("#arrival").addEventListener("click", () => void run(async () => { await ctx.create("Messages", { id: 2000 + arrival, sender: "Priya Shah", senderAddress: "priya.shah@example.test", recipient: "alex@example.test", subject: `New arrival ${arrival++}`, body: "A new message arrived while you were working. Your drafts and open messages stay mounted.", folder: "Inbox", unread: true, date: new Date().toISOString() }); await refreshCounts(); model.notice.value = "A sample message arrived in Inbox."; }));
  const background = instance.activity.run(({ signal, refresh, markFresh }) => {
    if (!$("#background").checked) return;
    const update = async () => {
      if (signal.aborted || !$("#background").checked || auth.recovering.peek()) return;
      await run(async () => { await instance.commands.refresh.execute(); markFresh(); }, "Mail couldn’t refresh");
    };
    if (refresh) void update();
    const interval = setInterval(() => void update(), 30_000);
    return () => clearInterval(interval);
  });
  const visibility = () => instance.activity.setActive(!document.hidden);
  document.addEventListener("visibilitychange", visibility);
  instance.lifetime.defer(() => document.removeEventListener("visibilitychange", visibility));
  $("#background").addEventListener("change", () => background.invalidate());
  visibility();
  await refreshCounts();
  globalThis.mailDemo = { auth, ctx, mock, instance, calls, background, get loginCount() { return loginCount; } };
  addEventListener("pagehide", event => { if (!event.persisted) { stop(); stopFeedback(); commandStops.forEach(dispose => dispose()); auth.dispose(); instance.dispose(); } });
} catch (error) { $("#mail").setAttribute("role", "alert"); $("#mail").textContent = error.message; auth.dispose(); }
