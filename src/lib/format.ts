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
