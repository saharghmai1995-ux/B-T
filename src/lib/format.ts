/**
 * v2.5 — Safe date/time formatting (single source of truth).
 * The old manual converters printed `0000/00/00 00:00:00` whenever a null,
 * undefined, zero-epoch or pre-2020 value reached the formatter. This module
 * kills that bug 100%: every invalid or implausible date collapses to "—".
 * Used by the Official Ledger (lockedAt/settledAt), the Shadow Book
 * (decidedAt) and the 3D football pitch (kickoff) — and everywhere else a
 * timestamp from the DB/ESPN reaches the UI.
 */

export function formatSafeDateTime(input?: string | number | Date | null): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime()) || d.getFullYear() < 2020) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d); // clean output, zero font glitches: "21 Nov 2026, 14:45"
}

/** Date-only variant of the same guard (e.g. chart axis / day buckets). */
export function formatSafeDate(input?: string | number | Date | null): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime()) || d.getFullYear() < 2020) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(d);
}

/**
 * v2.7 — Pick of the Day gate: strictly matches TODAY in Asia/Tehran.
 * The comparison uses the en-CA YYYY-MM-DD locale output on both sides so
 * every browser engine agrees on what "today" means for the golden card.
 */
export function isSameTehranDay(isoDate: string | number | Date | null | undefined, now: Date = new Date()): boolean {
  if (!isoDate) return false;
  const d = isoDate instanceof Date ? isoDate : new Date(isoDate);
  if (isNaN(d.getTime()) || d.getFullYear() < 2020) return false;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d) === fmt.format(now);
}
