// Calendar dates as `YYYY-MM-DD`, with no time zone: what Edm.Date holds.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function iso(year: number, month: number, day: number): string | undefined {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return d.toISOString().slice(0, 10);
}

/** "7 Oct 2026" for `2026-10-07`; other text unchanged. Month names are ours, the same in every engine. */
export function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${Number(m[3])} ${SHORT[Number(m[2]) - 1]} ${m[1]}` : value;
}

/**
 * A typed date: `2026-10-07`, `7/10/2026` (day first), `7 Oct 2026`,
 * `Oct 7 2026`, or `7 Oct` (this year). `undefined` when it isn't one.
 */
export function parseDate(text: string, thisYear: number): string | undefined {
  const t = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (m) return iso(year(m[3]!), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2}) ([a-z]+)\.?(?: (\d{2}|\d{4}))?$/.exec(t);
  if (m) return byName(m[2]!, Number(m[1]), m[3] ? year(m[3]) : thisYear);
  m = /^([a-z]+)\.? (\d{1,2})(?: (\d{2}|\d{4}))?$/.exec(t);
  if (m) return byName(m[1]!, Number(m[2]), m[3] ? year(m[3]) : thisYear);
  return undefined;
}

function year(text: string): number {
  return text.length === 2 ? 2000 + Number(text) : Number(text);
}

function byName(name: string, day: number, y: number): string | undefined {
  const month = MONTHS.indexOf(name.slice(0, 3));
  return month < 0 ? undefined : iso(y, month + 1, day);
}

/** Adds days, months (clamped to the month's end) or years. */
export function shift(value: string, by: { days?: number; months?: number; years?: number }): string {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  if (by.days) return new Date(Date.UTC(y, m - 1, d + by.days)).toISOString().slice(0, 10);
  const months = (by.months ?? 0) + (by.years ?? 0) * 12;
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(d, last))!;
}

/** Monday of `value`'s week, and Sunday. */
export function weekBounds(value: string): [string, string] {
  const day = (new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7;
  return [shift(value, { days: -day }), shift(value, { days: 6 - day })];
}

/** The weeks of `value`'s month, Monday to Sunday, padded with the days of the months either side (the calendar leaves those blank). */
export function monthWeeks(value: string): string[][] {
  const first = `${value.slice(0, 7)}-01`;
  let day = weekBounds(first)[0];
  const weeks: string[][] = [];
  do {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = shift(day, { days: 1 });
    }
    weeks.push(week);
  } while (day.slice(0, 7) === value.slice(0, 7));
  return weeks;
}

let now = () => Date.now();

/** Sets where "today" comes from: an app with its own clock (frozen in tests) passes it here. */
export function setClock(clock: () => number): void {
  now = clock;
}

/** Today as `YYYY-MM-DD`, in UTC like the dates themselves. */
export function today(): string {
  return new Date(now()).toISOString().slice(0, 10);
}
