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
