const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * A short relative time: "Just now", "18 min ago", "1 h ago", "Yesterday",
 * a weekday within the week, then a date. Always pair it with
 * `absoluteTime` on hover.
 */
export function relativeTime(iso: string, now: number, timeZone?: string): string {
  const t = Date.parse(iso);
  const ago = now - t;
  if (ago < MINUTE) return "Just now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  const days = dayNumber(now, timeZone) - dayNumber(t, timeZone);
  if (days === 0) return `${Math.floor(ago / HOUR)} h ago`;
  if (days === 1) return "Yesterday";
  const opts: Intl.DateTimeFormatOptions = timeZone ? { timeZone } : {};
  if (days < 7) return new Intl.DateTimeFormat("en-GB", { weekday: "short", ...opts }).format(t);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...opts }).format(t);
}

/** "Wed 7 Oct 2026, 14:57". */
export function absoluteTime(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(Date.parse(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/** Whole days since the epoch in the time zone, for "yesterday" and weekday names. */
function dayNumber(t: number, timeZone?: string): number {
  const p = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(t);
  return Math.floor(Date.parse(`${p}T00:00:00Z`) / 86_400_000);
}

/** "£41.2k", "£980", "£1.3m": compact, for figures. Never truncated. */
export function compactMoney(amount: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  })
    .format(amount)
    .replace(/K$/, "k")
    .replace(/M$/, "m")
    .replace(/^-/, "−");
}
