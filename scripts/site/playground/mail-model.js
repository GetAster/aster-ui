import { Command, Collection, CompositeSessions, DataContext, Selection, command, computed, effect, compositeTypes as t, defineCompositeModel, signal, selectionPublication, keyText } from "../lib/aster-ui.js";

export const validRecipient = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function createMailWorkspace({ ctx, refreshCounts, sessionRegistry }, lifetime, activity) {
  const folder = signal("Inbox"), search = signal("");
  const notice = signal("Mock mail. Messages and drafts stay in this visit.");
  const collection = ctx.collection(computed(() => ({ set: "Messages", orderBy: [{ field: "id", descending: true }],
    filter: { op: "and", args: [{ op: "eq", field: "folder", value: folder.value }, ...(search.value.trim() ? [{ op: "contains", field: "subject", value: search.value.trim() }] : [])] },
  })), { pageSize: 20, keepPages: 3 });
  lifetime.defer(() => ctx.release(collection));
  const selection = new Selection(ctx.store, collection, { multiple: true, fallback: false });
  const active = signal("welcome");
  const panels = lifetime.own(new CompositeSessions(sessionRegistry, { activity }));
  const sessions = computed(() => panels.sessions.value.map(handle => handle.descriptor.inputs.session));
  lifetime.defer(effect(() => panels.activate(active.value === "welcome" ? undefined : active.value)));
  const add = session => panels.reconcile([...panels.sessions.peek().map(handle => handle.descriptor),
    { key: session.id, type: "MailPanel", inputs: { session }, inactive: "pause" }]);
  let nextDraft = 1;
  let nextMessage = 1000;
  const currentDraft = computed(() => sessions.value.find(session => session.id === active.value && session.kind === "draft"));
  const items = computed(() => [{ value: "welcome", label: "Reading pane" }, ...sessions.value.map(session => ({ value: session.id,
    label: (session.subject.value || "New message") + (session.dirty.value ? " •" : ""), closable: true }))]);
  const own = options => lifetime.own(command(options));
  function open(record) {
    if (!record) return;
    const id = `message-${record.id}`;
    if (!sessions.peek().some(session => session.id === id)) add({ id, kind: "message", record,
      subject: signal(record.subject), dirty: signal(false) });
    active.value = id;
  }
  async function close(id) {
    if (await panels.requestClose(id) && active.peek() === id) active.value = "welcome";
  }
  function newDraft(values = {}) {
    const draft = { id: `draft-${nextDraft++}`, kind: "draft", to: signal(values.to ?? ""), subject: signal(values.subject ?? ""), body: signal(values.body ?? ""), dirty: signal(!!values.subject), busy: signal(false), error: signal("") };
    add(draft); active.value = draft.id;
  }
  function reply(record) { newDraft({ to: record.senderAddress, subject: /^Re:/i.test(record.subject) ? record.subject : `Re: ${record.subject}`, body: `\n\nOn ${record.date}, ${record.sender} wrote:\n${record.body}` }); }
  const commands = {
    open: own({ label: "Open selected", enabled: () => selection.any.value, run: () => { for (const record of selection.records.peek()) open(record); } }),
    compose: own({ label: "New message", run: () => newDraft() }),
    refresh: own({ label: "Refresh mail", run: async () => {
      const results = await Promise.allSettled([collection.refresh(), refreshCounts()]);
      const failed = results.find(result => result.status === "rejected");
      if (failed) throw failed.reason;
      notice.value = "Mail refreshed. Open messages and drafts are retained.";
    } }),
    read: own({ label: "Mark read", enabled: () => selection.any.value, run: async () => {
      await Promise.all(selection.records.peek().map(record => ctx.update("Messages", keyText([record.id]), { unread: false })));
      await refreshCounts(); notice.value = "Selected messages marked as read.";
    } }),
    send: own({ label: "Send message", enabled: () => {
      const draft = currentDraft.value;
      return !!draft && !draft.busy.value && validRecipient(draft.to.value) && !!draft.subject.value.trim() && !!draft.body.value.trim();
    }, reason: () => "Enter a valid recipient email address, subject and message before sending.", run: async signal => {
      const draft = currentDraft.peek();
      if (!draft || !validRecipient(draft.to.peek())) throw new Error("Enter a valid recipient email address.");
      draft.busy.value = true; draft.error.value = "";
      try {
        await ctx.create("Messages", { id: nextMessage++, sender: "Alex Morgan", senderAddress: "alex@example.test", recipient: draft.to.peek(), subject: draft.subject.peek(), body: draft.body.peek(), folder: "Sent", unread: false, date: new Date().toISOString() });
        signal.throwIfAborted(); draft.dirty.value = false;
        panels.remove(draft.id);
        if (active.peek() === draft.id) active.value = "welcome";
        notice.value = "Message sent to the mock Sent folder."; await refreshCounts();
      } catch (error) { draft.error.value = friendlyError(error); throw error; }
      finally { draft.busy.value = false; }
    } }),
  };
  return { values: { collection, selection, folder, search, notice, active, sessions, panels, items, currentDraft, open, close, reply }, commands, publications: { selection: selectionPublication(selection) } };
}

export function friendlyError(error) {
  switch (error?.reason) {
    case "cancelled": return "Sign-in cancelled. Your unsent messages are still here. Try again when you’re ready.";
    case "identity-changed": return "The account changed. Reload before continuing; this operation was not resumed.";
    case "failed": return "Sign-in could not be completed. Your unsent messages are still here. Try again.";
    case "timeout": return "Sign-in timed out. Your draft is retained.";
    case "retry-limit": return "The service still requires sign-in. Try again later.";
    default: return "Please try again. Your open messages and drafts have been kept.";
  }
}

export const mailWorkspaceType = defineCompositeModel({
  inputs: { ctx: t.instance(DataContext), refreshCounts: t.custom("refresh counts function", value => typeof value === "function"), sessionRegistry: t.custom("session component registry", value => typeof value?.component === "function") },
  exports: { collection: t.instance(Collection), selection: t.instance(Selection), folder: t.signal(t.string), search: t.signal(t.string), notice: t.signal(t.string), active: t.signal(t.string),
    panels: t.instance(CompositeSessions), sessions: t.signal(t.array(t.custom("mail session", value => !!value?.id))), items: t.signal(t.array(t.object({ value: t.string, label: t.string, closable: t.optional(t.boolean), disabled: t.optional(t.boolean) }))),
    currentDraft: t.signal(t.optional(t.custom("mail draft", value => value?.kind === "draft"))), open: t.custom("open message function", value => typeof value === "function"), close: t.custom("close tab function", value => typeof value === "function"), reply: t.custom("reply function", value => typeof value === "function") },
  commands: Object.fromEntries(["open", "compose", "refresh", "read", "send"].map(name => [name, t.instance(Command)])),
  publications: { selection: t.publication({ any: t.boolean, many: t.boolean, count: t.number }) }, create: createMailWorkspace,
});
