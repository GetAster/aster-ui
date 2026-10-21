// 100,000 time entries, generated the same way every time from a seed, so
// the Time page has real volume without a 10 MB fixture in the repository.

interface Ref {
  readonly id: number;
}

export interface TimeEntry {
  id: number;
  date: string;
  personId: number;
  projectId: number;
  hours: string;
  billable: boolean;
  status: "draft" | "submitted" | "approved";
  note: string | null;
}

const WORK = [
  "Pairing on the migration",
  "Client call",
  "Reviewed the pull requests",
  "Fixed the flaky build",
  "Wrote the release notes",
  "Workshop with the design team",
  "Estimates for the next phase",
  "Investigated the slow report",
  "Updated the onboarding guide",
  "Support rotation",
];
const MORE = [
  "Waiting on the vendor for access, so the second half went on documentation.",
  "Agreed the scope with the client; the change request follows tomorrow.",
  "Found two more edge cases in the import, both logged with examples.",
  "The staging data was stale, so most of the afternoon was spent refreshing it before the tests meant anything.",
  "Handed over to Grace for the evening.",
];

/** A small, fast, seeded generator (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` entries over the 400 days up to `today`, newest days most likely
 * to be drafts. Notes vary from none to several sentences, so rows vary in
 * height.
 */
export function timeEntries(count: number, people: readonly Ref[], projects: readonly Ref[], today: string, seed = 7): TimeEntry[] {
  const r = random(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const pickTwo = <T>(xs: readonly T[]): [T, T] => {
    const i = Math.floor(r() * xs.length);
    const j = (i + 1 + Math.floor(r() * (xs.length - 1))) % xs.length;
    return [xs[i]!, xs[j]!];
  };
  const end = Date.parse(`${today}T00:00:00Z`);
  const out: TimeEntry[] = [];
  for (let id = 1; id <= count; id++) {
    const daysAgo = Math.floor(r() ** 1.6 * 400);
    const date = new Date(end - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const quarters = 1 + Math.floor(r() * 32);
    const shape = r();
    const note =
      shape < 0.15 ? null
      : shape < 0.75 ? pick(WORK)
      : shape < 0.95 ? `${pick(WORK)}. ${pick(MORE)}`
      : `${pick(WORK)}. ${pickTwo(MORE).join(" ")}`;
    out.push({
      id,
      date,
      personId: pick(people).id,
      projectId: pick(projects).id,
      hours: (quarters / 4).toFixed(2),
      billable: r() < 0.7,
      status: daysAgo < 7 && r() < 0.6 ? "draft" : daysAgo < 30 && r() < 0.5 ? "submitted" : "approved",
      note,
    });
  }
  return out;
}
