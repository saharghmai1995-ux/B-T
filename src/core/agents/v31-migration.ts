/**
 * NeoBet Quant Pro v3.1 — one-time SuperAgent metadata migration.
 * Backfills tier / shieldType / noLossProb / consensusPct on legacy SINGLE_EV
 * rows using HONEST approximations derived ONLY from stored fields:
 *  - shieldType from the market's structural shape (DNB = push shield, DC =
 *    double outcome, everything else = direct win),
 *  - noLossProb = stored modelProb (exact for draw-inclusive DC markets; the
 *    conservative lower bound for DNB where draw mass is not stored),
 *  - consensusPct = agreement between the quant view (modelProb) and the
 *    market consensus view (trueProb): 100 − |Δ| × 150,
 *  - tier = v3.1 ladder (S ≥82% no-loss & ≥85 consensus, A 74–81 & ≥78,
 *    B 68–73 & ≥72).
 * Flag: Setting "superagentV31". Idempotent, crash-proofed, never blocks
 * bootstrap (all failures are contained).
 */

import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/core/pipeline/settings";
import { assignConfidenceTier } from "./push-shield-selector";

export const SUPERAGENT_V31_KEY = "superagentV31";

export interface V31MigrationSummary {
  skipped: boolean;
  updated: number;
  tiers: Record<string, number>;
  ranAt: string;
}

type ShieldShape = "DIRECT_WIN" | "FULL_PUSH_SHIELD" | "HALF_PUSH_SHIELD" | "DOUBLE_OUTCOME_SHIELD";

function shieldShapeOf(marketKey: string): ShieldShape {
  if (marketKey === "dnb") return "FULL_PUSH_SHIELD";
  if (marketKey === "dc_1x" || marketKey === "dc_x2") return "DOUBLE_OUTCOME_SHIELD";
  if (marketKey === "AH_PLUS_025") return "HALF_PUSH_SHIELD";
  if (
    marketKey === "DNB_AH0" || marketKey === "OVER_2_0" || marketKey === "UNDER_3_0"
  ) return "FULL_PUSH_SHIELD";
  return "DIRECT_WIN";
}

const consensusPctOf = (modelProb: number, trueProb: number): number =>
  Math.round(Math.min(100, Math.max(0, 100 - Math.abs(modelProb - trueProb) * 150)) * 10) / 10;

export async function runSuperAgentV31Migration(opts?: { force?: boolean }): Promise<V31MigrationSummary> {
  const ranAt = new Date().toISOString();
  const empty: V31MigrationSummary = { skipped: true, updated: 0, tiers: {}, ranAt };
  try {
    const flag = await getSetting(SUPERAGENT_V31_KEY);
    if (flag && !opts?.force) return empty;

    const legacy = await db.signal.findMany({
      where: { line: "SINGLE_EV", tier: null },
      select: { id: true, marketKey: true, modelProb: true, trueProb: true },
      take: 600,
    });

    const tiers: Record<string, number> = {};
    for (const row of legacy) {
      const noLossProb = Math.min(1, Math.max(0, row.modelProb));
      const consensus = consensusPctOf(row.modelProb, row.trueProb);
      const tier = assignConfidenceTier(noLossProb, consensus);
      tiers[tier ?? "UNTIERED"] = (tiers[tier ?? "UNTIERED"] ?? 0) + 1;
      await db.signal.update({
        where: { id: row.id },
        data: {
          shieldType: shieldShapeOf(row.marketKey),
          noLossProb,
          consensusPct: consensus,
          tier: tier ?? null,
        },
      });
    }

    await setSetting(SUPERAGENT_V31_KEY, ranAt);
    return { skipped: false, updated: legacy.length, tiers, ranAt };
  } catch (err) {
    console.error("[v3.1] superagent migration failed (contained):", err);
    return { ...empty, skipped: true };
  }
}
