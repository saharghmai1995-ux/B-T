/**
 * NeoBet Quant Pro v3.1 — Shield integration bridge.
 * Connects the parallel SuperAgent orchestrator to the ingest pipeline:
 *  - loads the calibration context (Platt + adaptive weights) from settled rows
 *  - runs the ensemble per fixture and issues TIER-S/A/B shield signals
 *  - moves vetoed fixtures to the Shadow Ledger (tracked with REAL results)
 *  - settles pending shield vetoes against real FT scores
 */

import { db } from "@/lib/db";
import type { MatchContext, TeamStat } from "@/core/types";
import { FLAT_VIEW_STAKE } from "@/core/math/kelly";
import { round2 } from "@/core/math/devig";
import {
  buildFootballProtectedCandidates,
  buildTennisProtectedCandidates,
} from "./push-shield-selector";
import { buildNbaProtectedCandidates, nbaWinProbabilities, type NbaMatchFeatures } from "@/engines/nba/nba-selector";
import {
  runQuantAgent,
  runCoachAgent,
  runEnsemble,
  footballMarketPrior,
  tennisMarketPrior,
  type EnsembleQuote,
  type MarketPriorInput,
} from "./orchestrator";
import {
  computeCalibration,
  trainPlatt,
  computeEnsembleWeights,
  type CalibrationRow,
  type PlattParams,
  type EnsembleWeights,
} from "./calibration";
import { resolveSelection, type FixtureResult } from "@/core/ledger/settlement-engine";

export interface CalibrationContext {
  platt: PlattParams;
  weightsWithMarket: EnsembleWeights;
  weightsWithoutMarket: EnsembleWeights;
  decidedCount: number;
}

/** Build the SuperAgent-3 calibration context from settled ledger rows. */
export async function loadCalibrationContext(): Promise<CalibrationContext> {
  const rows = await db.signal.findMany({
    where: { status: { in: ["WON", "LOST", "VOID"] } },
    orderBy: { settledAt: "desc" },
    take: 300,
    select: { status: true, modelProb: true, noLossProb: true, netProfit: true, stake: true, sport: true, tier: true },
  });
  const calib: CalibrationRow[] = rows.map((r) => ({
    modelProb: r.noLossProb ?? r.modelProb,
    trueProb: null,
    status: r.status as CalibrationRow["status"],
    stake: r.stake,
    netProfit: r.netProfit ?? 0,
    sport: r.sport,
    tier: r.tier,
  }));
  const metrics = computeCalibration(calib);
  const platt = trainPlatt(calib);
  return {
    platt,
    weightsWithMarket: computeEnsembleWeights(metrics, true, platt),
    weightsWithoutMarket: computeEnsembleWeights(metrics, false, platt),
    decidedCount: metrics.decidedCount,
  };
}

export interface ShieldOutcome {
  issued: "SIGNAL" | "VETO" | null;
  tier?: string | null;
  reason?: string | null;
}

const SHIELD_VETO_REF = (espnEventId: string) => `${espnEventId}|SHIELD`;
export const SHADOW_CATEGORY_SHIELD = "SHIELD_ENGINE";

/**
 * Run the full parallel ensemble for ONE fixture and persist the outcome.
 * Returns SIGNAL when a Tier-cleared shield candidate is issued, VETO when
 * the fixture is moved to the shadow ledger, null when no candidates exist.
 */
export async function generateShieldForFixture(params: {
  ctx: MatchContext;
  quotes: EnsembleQuote[];
  refOdds: { home?: number; draw?: number; away?: number; over?: number; under?: number; totalLine?: number } | null;
  statHome: TeamStat | null;
  statAway: TeamStat | null;
  calib: CalibrationContext;
  /** v3.3 — REAL NBA features (standings differential + schedule B2B/rest). */
  nba?: { features: NbaMatchFeatures; completeness: number; notes: string[] };
}): Promise<ShieldOutcome> {
  const { ctx, quotes, refOdds, statHome, statAway, calib } = params;
  try {
    // v3.3 §4 — Engine 3 (NBA): the quant view comes straight from the
    // normal-CDF margin model over REAL ESPN standings differentials; no
    // Dixon-Coles/Markov factory exists for basketball.
    if (params.nba && ctx.sport === "basketball") {
      const { pHomeWin } = nbaWinProbabilities(params.nba.features);
      const nbaQuant = {
        pHome: pHomeWin,
        pDraw: 0, // NBA cannot draw (OT counts)
        pAway: 1 - pHomeWin,
        pOver2: 0, pExact2: 0, pUnder3: 0, pExact3: 0,
        completeness: params.nba.completeness,
        rejects: [] as string[],
      };
      const nbaCoach = {
        tacticalDelta: 0, // B2B/star penalties already live inside the margin model
        vetoFlags: params.nba.completeness < 0.65 ? ["No standings — unrated NBA pairing"] : [],
        notes: params.nba.notes,
      };
      const nbaCandidates = buildNbaProtectedCandidates(params.nba.features);
      const nbaWeights = calib.weightsWithoutMarket; // no NBA sharp prior layer yet
      const nbaVerdict = runEnsemble(ctx, nbaQuant, nbaCoach, calib.platt, nbaWeights, null, nbaCandidates);
      if (!nbaVerdict) return { issued: null };
      return await persistShieldVerdict(ctx, nbaVerdict);
    }

    const quant = runQuantAgent(ctx, quotes, statHome, statAway);
    if (!quant) return { issued: null };

    const coach = runCoachAgent(ctx, quant, statHome, statAway);
    const marketPrior: MarketPriorInput | null =
      ctx.sport === "football" ? footballMarketPrior(refOdds) : tennisMarketPrior(quotes);

    const candidates =
      ctx.sport === "football"
        ? buildFootballProtectedCandidates({
            homeTeam: ctx.homeName,
            awayTeam: ctx.awayName,
            pHome: quant.pHome,
            pDraw: quant.pDraw,
            pAway: quant.pAway,
            pOver2: quant.pOver2,
            pExact2: quant.pExact2,
            pUnder3: quant.pUnder3,
            pExact3: quant.pExact3,
          })
        : buildTennisProtectedCandidates({
            homePlayer: ctx.homeName,
            awayPlayer: ctx.awayName,
            // v3.2 §3 — REAL rankings feed the hard Elo-1500 rejection.
            homeRank: ctx.homeRank ?? null,
            awayRank: ctx.awayRank ?? null,
            winnerHome: quotes.find((q) => q.marketKey === "winner" && q.selection === "HOME")?.modelProb ?? 0,
            winnerAway: quotes.find((q) => q.marketKey === "winner" && q.selection === "AWAY")?.modelProb ?? 0,
            setBet20Home: quotes.find((q) => q.marketKey === "setbet_2_0" && q.selection === "HOME")?.modelProb ?? 0,
            setBet20Away: quotes.find((q) => q.marketKey === "setbet_2_0" && q.selection === "AWAY")?.modelProb ?? 0,
            gameHandHomePlus35: quotes.find((q) => q.marketKey === "gamehand_home_+3.5")?.modelProb ?? null,
            gameHandAwayPlus35: quotes.find((q) => q.marketKey === "gamehand_away_+3.5")?.modelProb ?? null,
            gameHandHomeMinus35: quotes.find((q) => q.marketKey === "gamehand_home_-3.5")?.modelProb ?? null,
            gameHandAwayMinus35: quotes.find((q) => q.marketKey === "gamehand_away_-3.5")?.modelProb ?? null,
          });

    const weights = marketPrior ? calib.weightsWithMarket : calib.weightsWithoutMarket;
    const verdict = runEnsemble(ctx, quant, coach, calib.platt, weights, marketPrior, candidates);
    if (!verdict) return { issued: null };
    return await persistShieldVerdict(ctx, verdict);
  } catch (err) {
    // The shield line NEVER blocks the ingest pipeline.
    console.error("[v3.1] shield ensemble failed:", err);
    return { issued: null };
  }
}

/** v3.3 — shared SHIELD persistence for the football/tennis AND NBA paths. */
async function persistShieldVerdict(
  ctx: MatchContext,
  verdict: NonNullable<ReturnType<typeof runEnsemble>>,
): Promise<ShieldOutcome> {
  try {
    // Dedupe: one shield row per match, and veto rows are idempotent.
    const espnEventId = await db.match
      .findUnique({ where: { id: ctx.id }, select: { espnEventId: true } })
      .then((m) => m?.espnEventId ?? ctx.id);

    if (!verdict.vetoReason && verdict.tier) {
      const existing = await db.signal.findFirst({
        where: { matchId: ctx.id, line: "SHIELD", status: "OPEN" },
        select: { id: true },
      });
      if (existing) return { issued: null };
      const hashInput = {
        matchInfo: `${ctx.homeName} vs ${ctx.awayName}`,
        sport: ctx.sport,
        line: "SHIELD",
        marketKey: verdict.candidate.marketKey,
        selection: verdict.candidate.selection,
        price: verdict.price,
        modelProb: round2(verdict.noLossProb * 100) / 100,
        evPct: round2((verdict.candidate.winProb * verdict.price - 1) * 1000) / 10,
        stake: FLAT_VIEW_STAKE,
        issuedAt: new Date().toISOString(),
      };
      const { lockSignal } = await import("@/core/ledger/sha256-chain");
      const hash = lockSignal(hashInput);
      await db.signal.create({
        data: {
          matchId: ctx.id,
          sport: ctx.sport,
          line: "SHIELD",
          marketKey: verdict.candidate.marketKey,
          marketLabel: verdict.candidate.posterLabel,
          selection: verdict.candidate.selection,
          modelProb: round2(verdict.candidate.winProb * 1000) / 1000,
          trueProb: round2(verdict.noLossProb * 1000) / 1000,
          price: verdict.price,
          evPct: round2((verdict.candidate.winProb * verdict.price - 1) * 1000) / 10,
          stake: FLAT_VIEW_STAKE,
          stakeMode: "FLAT_100",
          shaHash: hash,
          dayKey: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(new Date()),
          tier: verdict.tier,
          shieldType: verdict.candidate.shieldType,
          noLossProb: round2(verdict.noLossProb * 1000) / 1000,
          consensusPct: verdict.consensusPct,
          sharpSource: verdict.sharp.available ? verdict.sharp.source ?? null : null,
          sharpAlert: verdict.sharp.sharpDivergenceAlert,
        },
      });
      return { issued: "SIGNAL", tier: verdict.tier };
    }

    // Vetoed → Shadow Ledger with the model's default pick tracked.
    const signalRef = SHIELD_VETO_REF(espnEventId);
    const existingVeto = await db.shadowVeto.findFirst({
      where: { signalRef, category: SHADOW_CATEGORY_SHIELD },
      select: { id: true },
    });
    if (existingVeto) return { issued: null };
    await db.shadowVeto.create({
      data: {
        signalRef,
        reason: verdict.vetoReason ?? "No candidate cleared the Tier S/A/B ladder",
        category: SHADOW_CATEGORY_SHIELD,
        sport: ctx.sport,
        league: ctx.league,
        repMatch: `${ctx.homeName} vs ${ctx.awayName}`,
        marketLabel: verdict.candidate.marketKey,
        selection: verdict.candidate.selection,
        price: verdict.price,
        modelProb: round2(verdict.noLossProb * 1000) / 1000,
        startTime: ctx.startTime,
        // v3.1 — "PENDING" (not null) so the generic shadow-hygiene purge
        // (which deletes verdict-null rows) never eats live shield vetoes
        // before their fixture finishes; settlePendingShieldVetoes flips it.
        verdict: "PENDING",
      },
    });
    return { issued: "VETO", reason: verdict.vetoReason };
  } catch (err) {
    console.error("[v3.1] shield verdict persistence failed:", err);
    return { issued: null };
  }
}

/**
 * Settle PENDING shield vetoes for one finished fixture against the REAL FT
 * score: LOST → SAVED_LOSS (+flat), WON → MISSED_WIN (−flat·(price−1)),
 * VOID/push → UNKNOWN with 0 impact (stake would have been returned).
 */
export async function settlePendingShieldVetoes(
  espnEventId: string,
  fixture: FixtureResult,
): Promise<number> {
  try {
    const pending = await db.shadowVeto.findMany({
      where: { signalRef: SHIELD_VETO_REF(espnEventId), category: SHADOW_CATEGORY_SHIELD, verdict: "PENDING" },
    });
    let settled = 0;
    for (const veto of pending) {
      if (!veto.marketLabel || !veto.selection || veto.price == null) continue;
      const sport = veto.sport === "tennis" ? "tennis" : "football";
      const v = resolveSelection(veto.marketLabel, veto.selection, { ...fixture, sport });
      const flat = FLAT_VIEW_STAKE;
      const ftScore = `${fixture.homeScore}-${fixture.awayScore}`;
      if (v.status === "LOST") {
        await db.shadowVeto.update({
          where: { id: veto.id },
          data: { verdict: "SAVED_LOSS", savedUnits: flat, ftScore, decidedAt: new Date() },
        });
        settled++;
      } else if (v.status === "WON") {
        const missed = v.factor >= 1 ? flat * (veto.price - 1) : flat * 0.5 * (veto.price - 1);
        await db.shadowVeto.update({
          where: { id: veto.id },
          data: { verdict: "MISSED_WIN", savedUnits: -round2(missed), ftScore, decidedAt: new Date() },
        });
        settled++;
      } else {
        await db.shadowVeto.update({
          where: { id: veto.id },
          data: { verdict: "UNKNOWN", savedUnits: 0, ftScore, decidedAt: new Date() },
        });
        settled++;
      }
    }
    return settled;
  } catch (err) {
    console.error("[v3.1] shield veto settlement failed:", err);
    return 0;
  }
}
