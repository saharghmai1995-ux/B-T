/**
 * v3.3 §2 — Active Picks Service (Strict Pre-Match Gate).
 *
 * `status === "OPEN"` alone is NOT enough: stale OPEN picks (>4h past kickoff)
 * leaked past-dated tennis cards into Predictions Hub. This service:
 *   1. sweeps stale OPEN picks into the PENDING_SETTLEMENT queue (one bulk op)
 *   2. exposes `isStrictlyUpcoming` (re-exported from lib/format so the client
 *      can use the identical pure gate without bundling Prisma).
 */

import { db } from "@/lib/db";
import { isStrictlyUpcoming } from "@/lib/format";

export { isStrictlyUpcoming };

const FOUR_HOURS_MS = 4 * 3600_000;

/**
 * Move stale OPEN picks (>4h past kickoff) out of Predictions Hub into the
 * Settlement Queue. Never throws — a failed sweep only means the strict
 * upcoming filter still protects the UI.
 */
export async function sweepStaleOpenPicks(nowMs: number = Date.now()): Promise<number> {
  try {
    const staleCutoff = new Date(nowMs - FOUR_HOURS_MS);
    const res = await db.signal.updateMany({
      where: {
        status: "OPEN",
        match: { startTime: { lt: staleCutoff } },
      },
      data: { status: "PENDING_SETTLEMENT" },
    });
    return res.count;
  } catch (err) {
    console.error("[v3.3] sweepStaleOpenPicks failed:", err);
    return 0;
  }
}

/** Minimal shape the dedupe gate needs (Signal rows already satisfy it). */
export interface ActivePickLike {
  matchId: string;
  noLossProb: number | null;
}

/**
 * v3.3.2 §3 — Deduplicate strictly to the ONE highest-confidence card per
 * unique fixture. Fixtures like `Chapecoense vs Palmeiras` used to emit 3
 * simultaneous cards (SINGLE_EV + SHIELD + …) into Predictions Hub; now only
 * the best `noLossProb` card survives. ACCA rows are multi-fixture cards and
 * are intentionally OUT of this gate (the caller keeps them aside).
 * Pure function — unit-testable, no DB dependency.
 */
export function dedupeOneCardPerFixture<T extends ActivePickLike>(picks: T[]): T[] {
  const bestPerFixture = new Map<string, T>();
  for (const p of picks) {
    const prev = bestPerFixture.get(p.matchId);
    if (!prev || (p.noLossProb ?? 0) > (prev.noLossProb ?? 0)) {
      bestPerFixture.set(p.matchId, p);
    }
  }
  return Array.from(bestPerFixture.values());
}
