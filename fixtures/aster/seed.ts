// Writes data.json next to this file: `bun fixtures/aster/seed.ts`.
// Deterministic: a seeded PRNG and a fixed base date, no clock.
import { writeFileSync } from "node:fs";

const BASE = Date.UTC(2026, 9, 7, 15, 15, 0); // the mockup's "now", Wednesday
const DAY = 86_400_000;

let state = 20261007;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(list: readonly T[]): T => list[int(0, list.length - 1)]!;

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const money = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

const peopleRows: [string, string, number][] = [
  ["Ada Lovelace", "ada", 45],
  ["Grace Hopper", "grace", 165],
  ["Alan Kay", "alan", 285],
  ["Edsger Dijkstra", "edsger", 85],
  ["Barbara Liskov", "barbara", 230],
  ["Donald Knuth", "donald", 52],
  ["Margaret Hamilton", "margaret", 184],
  ["Katherine Johnson", "katherine", 306],
  ["Dennis Ritchie", "dennis", 98],
  ["Radia Perlman", "radia", 236],
  ["Ken Thompson", "ken", 18],
  ["Frances Allen", "frances", 164],
];
const People = peopleRows.map(([name, handle, hue], i) => ({
  id: i + 1,
  name,
  email: `${handle}@aster.example`,
  hue,
}));

const adjectives = ["Atlas", "Beacon", "Cobalt", "Delta", "Ember", "Fjord", "Garnet", "Harbor", "Indigo", "Juniper", "Keystone", "Lumen", "Meridian", "Nimbus", "Orchid", "Pilot", "Quartz", "Relay", "Summit", "Tidal"];
const nouns = ["migration", "rollout", "redesign", "audit", "pilot", "integration", "refresh", "launch", "cleanup", "review", "onboarding", "reporting", "forecast", "rebuild", "survey"];

// The mockup's projects, updated when its rows say.
const fixed = [
  { name: "Spring launch", lead: 1, state: "active", health: "onTrack", behindDays: null, open: 23, hue: 45, updated: "2026-10-07T15:13:00Z" },
  { name: "Brand refresh", lead: 2, state: "active", health: "behind", behindDays: 3, open: 41, hue: 165, updated: "2026-10-07T14:57:00Z" },
  { name: "Billing v2", lead: 3, state: "active", health: "onTrack", behindDays: null, open: 17, hue: 285, updated: "2026-10-07T14:15:00Z" },
  { name: "Onboarding emails", lead: 4, state: "paused", health: "onTrack", behindDays: null, open: 9, hue: 85, updated: "2026-10-06T17:40:00Z" },
  { name: "Help centre migration", lead: 5, state: "active", health: "needsReview", behindDays: null, open: 58, hue: 230, updated: "2026-10-05T10:02:00Z" },
] as const;

interface Project {
  id: number; name: string; leadId: number; state: string; health: string; behindDays: number | null;
  budget: string; spent: string; pinned: boolean; hue: number;
  createdAt: string; updatedAt: string; archivedAt: string | null;
}
const Projects: Project[] = [];
const openCounts: number[] = [];
const used = new Set<string>(fixed.map((f) => f.name));

for (let i = 0; i < 200; i++) {
  const f = fixed[i];
  const created = BASE - int(20, 270) * DAY - int(0, 86_399) * 1000;
  const updated = f ? Date.parse(f.updated) : BASE - int(1, 9) * DAY - int(0, 86_399) * 1000;
  let p: Omit<Project, "createdAt" | "updatedAt" | "archivedAt" | "budget" | "spent">;
  let open: number;
  if (f) {
    p = { id: i + 1, name: f.name, leadId: f.lead, state: f.state, health: f.health, behindDays: f.behindDays, pinned: i < 3, hue: f.hue };
    open = f.open;
  } else {
    let name = "";
    do name = `${pick(adjectives)} ${pick(nouns)}`; while (used.has(name));
    used.add(name);
    const r = rand();
    const state = r < 0.72 ? "active" : r < 0.86 ? "paused" : "archived";
    const health = state === "archived" ? "onTrack" : pick(["notStarted", "onTrack", "onTrack", "onTrack", "behind", "needsReview"]);
    p = { id: i + 1, name, leadId: int(1, People.length), state, health, behindDays: health === "behind" ? int(1, 14) : null, pinned: false, hue: int(0, 359) };
    open = state === "archived" ? 0 : int(0, 16);
  }
  const budgetCents = int(40, 900) * 50_000 + int(0, 99);
  const spentCents = Math.floor(budgetCents * (p.state === "archived" ? 0.6 + rand() * 0.45 : rand() * 0.9));
  Projects.push({
    ...p,
    budget: money(budgetCents),
    spent: money(spentCents),
    createdAt: iso(created),
    updatedAt: iso(Math.max(updated, created)),
    archivedAt: p.state === "archived" ? iso(BASE - int(1, 18) * DAY) : null,
  });
  openCounts.push(open);
}

const verbs = ["Draft", "Review", "Update", "Schedule", "Test", "Document", "Confirm", "Collect", "Prepare", "Fix", "Publish", "Estimate"];
const objects = ["copy", "wireframes", "pricing table", "release notes", "vendor contract", "style guide", "survey results", "onboarding flow", "KPI dashboard", "support macros", "legal terms", "analytics events", "launch checklist", "migration plan", "invoice template"];

interface Task { id: number; projectId: number; parentId: number | null; title: string; due: string | null; assigneeId: number | null; done: boolean }
const Tasks: Task[] = [];
const special: Record<number, Task[]> = {
  1: [{ id: 0, projectId: 1, parentId: null, title: "Launch email, second draft", due: "2026-10-09", assigneeId: 1, done: false }],
  2: [{ id: 0, projectId: 2, parentId: null, title: "Final logo files to print", due: "2026-10-08", assigneeId: 2, done: false }],
  3: [{ id: 0, projectId: 3, parentId: null, title: "Proration rules sign-off", due: "2026-10-09", assigneeId: 3, done: false }],
};

for (const p of Projects) {
  const open = openCounts[p.id - 1]!;
  const done = p.id <= 5 ? int(5, 14) : int(1, 8);
  const rows: Task[] = [...(special[p.id] ?? [])];
  const make = (isDone: boolean): Task => {
    // Open tasks avoid the rest of this week, so "Due this week" shows the mockup's three.
    const offset = isDone ? -int(1, 60) : rand() < 0.2 ? -int(1, 10) : int(5, 45);
    return {
      id: 0,
      projectId: p.id,
      parentId: null,
      title: `${pick(verbs)} ${pick(objects)}`,
      due: rand() < 0.2 ? null : day(BASE + offset * DAY),
      assigneeId: rand() < 0.15 ? null : int(1, People.length),
      done: isDone,
    };
  };
  while (rows.filter((t) => !t.done).length < open) rows.push(make(false));
  for (let i = 0; i < done; i++) rows.push(make(true));
  for (const t of rows) Tasks.push({ ...t, id: Tasks.length + 1 });
}

for (let i = 0; i < 5; i++) {
  const n = Tasks.filter((t) => t.projectId === i + 1 && !t.done).length;
  if (n !== fixed[i]!.open) throw new Error(`${fixed[i]!.name}: ${n} open tasks, expected ${fixed[i]!.open}`);
}

// Subtasks, after every top-level task so their ids come last and the
// figures (which count top-level tasks) don't change. Project 4 carries the
// tree's stress cases: a chain nine levels deep and one level of 3,000.
const steps = ["Check", "Draft", "Agree", "Book", "Send", "Sign off", "Proof", "Chase"];
const subjects = ["the brief", "numbers", "the vendor", "a review", "the final copy", "access", "the template", "feedback"];
const topLevel = Tasks.length;
const child = (parent: Task, title = `${pick(steps)} ${pick(subjects)}`): Task => {
  const t: Task = {
    id: Tasks.length + 1,
    projectId: parent.projectId,
    parentId: parent.id,
    title,
    due: parent.due,
    assigneeId: rand() < 0.3 ? null : int(1, People.length),
    done: parent.done || rand() < 0.3,
  };
  Tasks.push(t);
  return t;
};
for (let i = 0; i < topLevel; i++) {
  const task = Tasks[i]!;
  if (rand() >= 0.35) continue;
  for (let n = int(1, 4); n > 0; n--) {
    const sub = child(task);
    if (rand() < 0.25) for (let m = int(1, 3); m > 0; m--) child(sub);
  }
}
const backlog = Tasks.filter((t) => t.projectId === 4 && t.parentId === null);
let deep = backlog[0]!;
for (let level = 2; level <= 9; level++) deep = child(deep, `Level ${level}: ${pick(steps).toLowerCase()} ${pick(subjects)}`);
const wide = backlog[1]!;
for (let n = 1; n <= 3000; n++) child(wide, `Item ${n}: ${pick(steps).toLowerCase()} ${pick(subjects)}`);

const Notes = [
  {
    id: 1,
    body: "Brand refresh slips unless print files land by Thursday. Everything else can wait a week.\n\nGrace has the vendor’s new deadline. Ask before moving anything on Spring launch.",
    authorId: 1,
    createdAt: "2026-10-07T08:10:00Z",
    pinned: true,
  },
];

const Members = [
  { id: 1, personId: 1, name: "Ada Lovelace", email: "ada@aster.example", role: "owner" },
  { id: 2, personId: 2, name: "Grace Hopper", email: "grace@aster.example", role: "edit" },
  { id: 3, personId: 3, name: "Alan Kay", email: "alan@aster.example", role: "view" },
];

const ShareLinks = [
  { id: 1, url: "aster.example/p/7f3k", allowComments: true, allowDownloads: false, expiresIn30Days: false },
];

const data = { People, Projects, Tasks, Notes, Members, ShareLinks };
const body = Object.entries(data)
  .map(([set, rows]) => `  ${JSON.stringify(set)}: [\n${(rows as unknown[]).map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]`)
  .join(",\n");
writeFileSync(new URL("./data.json", import.meta.url), `{\n${body}\n}\n`);
console.log(`${People.length} people, ${Projects.length} projects, ${Tasks.length} tasks`);
