// The demo's whole seed: the fixture data with clients, time entries and the
// information model, as both the mock's worker and a live demo server load it.
import data from "./data.json";
import { clients } from "./clients.ts";
import { modelData } from "./model.ts";
import { timeEntries } from "./time.ts";

/** `today` (YYYY-MM-DD) is where the time entries end. */
export function demoData(o: { readonly clientCount: number; readonly timeCount: number; readonly today: string }): Record<string, unknown[]> {
  return {
    ...data,
    // Two projects in three have a client.
    Projects: data.Projects.map((p) => ({ ...p, clientId: p.id % 3 === 0 || o.clientCount === 0 ? null : 1 + ((p.id * 7919) % o.clientCount) })),
    Clients: clients(o.clientCount),
    TimeEntries: timeEntries(o.timeCount, data.People, data.Projects, o.today),
    ...modelData(),
  };
}
