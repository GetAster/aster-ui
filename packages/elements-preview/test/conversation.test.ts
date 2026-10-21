import { describe, expect, test } from "bun:test";
import { ConversationSession, type ConversationAdapter, type ConversationEntry, type ConversationWindow } from "../src/conversation/session.ts";

const entry = (n: number): ConversationEntry => ({ id: String(n), cursor: String(n), order: String(n).padStart(5, "0"), author: "Person", time: "10:00", text: `Message ${n}` });
const records = Array.from({ length: 100 }, (_, i) => entry(i));
const window = (start: number, end: number): ConversationWindow => ({ entries: records.slice(start, end), hasOlder: start > 0, hasNewer: end < records.length });
function adapter(): ConversationAdapter {
  return {
    async open({ at }) { return at === "latest" ? window(90, 100) : window(Math.max(0, Number(at.entryId) - 5), Math.min(100, Number(at.entryId) + 5)); },
    async older({ before }) { return window(Math.max(0, Number(before) - 10), Number(before)); },
    async newer({ after }) { return window(Number(after) + 1, Math.min(100, Number(after) + 11)); },
  };
}

describe("preview conversation windows", () => {
  test("bounded bidirectional windows retain ordering and explicit gaps", async () => {
    const session = new ConversationSession({ scope: "chat", title: "Chat", adapter: adapter(), maxEntries: 20 });
    await session.open(); await session.loadOlder(); await session.loadOlder(["85"]);
    expect(session.entries.value.map(e => e.id)).toEqual(records.slice(70, 90).map(e => e.id));
    expect(session.hasOlder.value).toBe(true); expect(session.hasNewer.value).toBe(true);
    await session.loadNewer(); expect(session.entries.value.map(e => e.id)).toEqual(records.slice(80, 100).map(e => e.id));
    expect(session.hasNewer.value).toBe(false); session.dispose();
  });

  test("focused or selected entries cannot be evicted by paging or notifications", async () => {
    const session = new ConversationSession({ scope: "chat", title: "Chat", adapter: adapter(), maxEntries: 10 });
    await session.open();
    expect(await session.loadOlder(["95"])).toBe(false);
    expect(session.error.value).toContain("Finish reading");
    expect(session.entries.value.at(-1)?.id).toBe("99");
    expect(session.receive(entry(100), ["90"])).toBe(false);
    expect(session.hasNewer.value).toBe(true); expect(session.entries.value[0]?.id).toBe("90"); session.dispose();
  });

  test("late open responses and disposed work cannot replace a newer location", async () => {
    const pending: { signal: AbortSignal; resolve: (page: ConversationWindow) => void }[] = [];
    const service = adapter(); service.open = ({ signal }) => new Promise(resolve => pending.push({ signal, resolve }));
    const session = new ConversationSession({ scope: "chat", title: "Chat", adapter: service });
    const first = session.open(), second = session.open({ entryId: "20" });
    expect(pending[0]!.signal.aborted).toBe(true);
    pending[1]!.resolve(window(15, 25)); await second;
    pending[0]!.resolve(window(90, 100)); await first;
    expect(session.entries.value[0]?.id).toBe("15");
    const third = session.open(); session.dispose(); pending[2]!.resolve(window(90, 100)); await third;
    expect(pending[2]!.signal.aborted).toBe(true); expect(session.entries.value[0]?.id).toBe("15");
  });

  test("failed history retains confirmed content and can retry", async () => {
    const service = adapter(); let failed = false;
    const older = service.older; service.older = request => { if (!failed) { failed = true; return Promise.reject(new Error("Offline")); } return older(request); };
    const session = new ConversationSession({ scope: "chat", title: "Chat", adapter: service });
    await session.open(); const entries = session.entries.value;
    await session.loadOlder(); expect(session.entries.value).toBe(entries); expect(session.error.value).toBe("Offline");
    expect(await session.retry()).toBe(true); expect(session.entries.value.length).toBe(20); session.dispose();
  });

  test("overlapping entries are unique and updates retain original order", async () => {
    const service = adapter(); service.older = async () => ({ entries: [entry(89), { ...entry(90), text: "Edited" }], hasOlder: true, hasNewer: true });
    const session = new ConversationSession({ scope: "chat", title: "Chat", adapter: service });
    await session.open(); await session.loadOlder();
    expect(session.entries.value.length).toBe(11); expect(session.entries.value.find(e => e.id === "90")?.text).toBe("Edited");
    session.receive({ ...entry(90), text: "Another edit" }); expect(session.entries.value[1]?.id).toBe("90"); session.dispose();
  });

  test("send coalesces writes and preserves both failed and newly edited drafts", async () => {
    const service = adapter(); let calls = 0, finish!: (entry: ConversationEntry) => void;
    service.send = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    const session = new ConversationSession({ scope: "chat", title: "Chat", adapter: service }); await session.open();
    session.draft.value = "First draft"; const sent = session.send(); expect(session.send()).toBe(sent);
    await Promise.resolve(); session.draft.value = "New draft while sending"; finish(entry(100));
    expect(await sent).toBe(true); expect(calls).toBe(1); expect(session.draft.value).toBe("New draft while sending");
    service.send = () => { throw new Error("Rejected"); };
    expect(await session.send()).toBe(false); expect(session.sendError.value).toBe("Rejected");
    expect(session.draft.value).toBe("New draft while sending"); session.dispose();
  });

  test("unavailable jumps retain history and around windows keep their target within the bound", async () => {
    const service = adapter(); const session = new ConversationSession({ scope: "chat", title: "Chat", adapter: service, maxEntries: 10 });
    await session.open(); const previous = session.entries.value;
    service.open = async () => window(10, 50);
    expect(await session.open({ entryId: "missing" })).toBe(false); expect(session.entries.value).toBe(previous);
    expect(await session.open({ entryId: "12" })).toBe(true); expect(session.entries.value.some(e => e.id === "12")).toBe(true);
    expect(session.entries.value.length).toBe(10); expect(session.hasNewer.value).toBe(true); session.dispose();
  });

  test("sending while browsing does not evict the protected reader or duplicate a write", async () => {
    const service = adapter(); service.send = async () => entry(100);
    const session = new ConversationSession({ scope: "chat", title: "Chat", adapter: service, maxEntries: 10 });
    await session.open(); session.draft.value = "Reply from history";
    expect(await session.send(() => ["90"])).toBe(true);
    expect(session.entries.value[0]?.id).toBe("90"); expect(session.hasNewer.value).toBe(true);
    expect(session.draft.value).toBe(""); session.dispose();
  });
});
