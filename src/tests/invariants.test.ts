/**
 * The 5 mandatory invariant tests (Vitest) — mathematical honesty guarantees.
 * Test 1: sum(categoryProfits) === bankroll - 1000 (zero discrepancy).
 * Test 2: no settled row with netProfit <= 0 is ever labelled WON.
 * Test 3: no price comes from edgeNudge / fixed 1.97/2.68; always
 *         price <= 1 / (trueProb * 1.04).
 * Test 4: every exportable selection is 100% whitelisted and no related
 *         contingency (× of two markets of one match) can exist.
 * Test 5: /api/bootstrap cold-start auto-ingests and returns a non-empty array.
 */

import { describe, it, expect } from "vitest";
import { computeMasterMetrics, statusFromProfit, settleNetProfit } from "@/core/ledger/ledger-service";
import { settleRow } from "@/core/ledger/settlement-engine";
import type { SettledRow, TeamStat } from "@/core/types";
import { marginPrice, BOOK_MARGIN, shinDevig } from "@/core/math/devig";
import { buildFootballQuotes } from "@/engines/football/football-selector";
import { MARKET_WHITELIST, assertMarketAllowed, assertNoRelatedContingency, getMarket } from "@/core/bookmakers/market-whitelist";
import { resolveBootstrapAction } from "@/core/pipeline/bootstrap-service";
import { runIngest } from "@/core/pipeline/ingest-service";
import { bootstrapState } from "@/core/pipeline/bootstrap-service";
import type { GatheredPack } from "@/core/pipeline/feed-gatherer";

const day = (n: number) => new Date(Date.now() - n * 86400_000);

function sampleRows(): SettledRow[] {
  return [
    row("1", "WON", 118, 100, 2.18, day(4)),
    row("2", "LOST", -100, 100, 1.95, day(3)),
    row("3", "WON", 86, 100, 1.86, day(2)),
    row("4", "VOID", 0, 100, 2.1, day(1)),
    row("5", "LOST", -100, 100, 2.05, day(1)),
  ];
}

function row(
  id: string, status: SettledRow["status"], netProfit: number,
  stake: number, price: number, settledAt: Date, sport = "football", line = "SINGLE_EV",
): SettledRow {
  return {
    id, sport, league: "Test League", line, marketKey: "1x2", marketLabel: "1X2",
    selection: "HOME", status, netProfit, stake, price, evPct: 5, settledAt,
    matchInfo: "A vs B",
  };
}

describe("Invariant 1 — ledger single source of truth", () => {
  it("sum(categoryProfits) === bankroll - 1000, exactly", () => {
    const rows = sampleRows();
    const m = computeMasterMetrics(rows, []);
    const sumLine = Object.values(m.categoryProfits.byLine).reduce((a, b) => a + b, 0);
    const sumSport = Object.values(m.categoryProfits.bySport).reduce((a, b) => a + b, 0);
    const sumLeague = Object.values(m.categoryProfits.byLeague).reduce((a, b) => a + b, 0);
    expect(m.bankroll).toBeCloseTo(m.startingBank + m.totalProfit, 6);
    expect(sumLine).toBeCloseTo(m.totalProfit, 6);
    expect(sumSport).toBeCloseTo(m.totalProfit, 6);
    expect(sumLeague).toBeCloseTo(m.totalProfit, 6);
    expect(m.totalProfit).toBeCloseTo(m.bankroll - 1000, 6);
    // cross-check arithmetic manually: 118 - 100 + 86 + 0 - 100 = 4
    expect(m.totalProfit).toBeCloseTo(4, 6);
    expect(m.bankroll).toBeCloseTo(1004, 6);
  });

  it("equity curve ends exactly at bankroll", () => {
    const m = computeMasterMetrics(sampleRows(), []);
    const last = m.equityCurve[m.equityCurve.length - 1];
    expect(last.bankroll).toBeCloseTo(m.bankroll, 6);
  });
});

describe("Invariant 2 — Win === positive profit", () => {
  it("never labels a non-positive profit as WON", () => {
    expect(statusFromProfit(0, "WON")).toBe("VOID");
    expect(statusFromProfit(-50, "WON")).toBe("LOST");
    expect(statusFromProfit(42, "WON")).toBe("WON");
  });

  it("honest -100u full loss and settleRow output obeys the rule", () => {
    expect(settleNetProfit("LOST", 100, 2.2)).toBe(-100);
    const r = sampleRows()[1];
    const verdict = settleRow(r, { sport: "football", homeScore: 2, awayScore: 0, retired: false });
    // selection HOME with home winning 2-0 → WON, profit = stake*(price-1) > 0
    if (verdict.status === "WON") expect(verdict.netProfit).toBeGreaterThan(0);
    if (verdict.status === "LOST") expect(verdict.netProfit).toBeLessThan(0);
    if (verdict.status === "VOID") expect(verdict.netProfit).toBe(0);
  });

  it("DNB on draw voids at exactly 0.0", () => {
    const r: SettledRow = { ...row("x", "OPEN", 0, 100, 2.0, day(1)), marketKey: "dnb", selection: "HOME" };
    const verdict = settleRow(r, { sport: "football", homeScore: 1, awayScore: 1, retired: false });
    expect(verdict.status).toBe("VOID");
    expect(verdict.netProfit).toBe(0);
  });
});

describe("Invariant 3 — zero fake odds", () => {
  const stats = (gf: number, ga: number, p = 12): TeamStat =>
    ({ name: "T", played: p, won: 7, drawn: 2, lost: 3, goalsFor: gf, goalsAgainst: ga });

  it("estimate prices always satisfy price <= 1/(trueProb * 1.04)", () => {
    const ctx = {
      id: "m1", sport: "football" as const, league: "Test League", leagueCode: "eng.1",
      homeName: "Alpha", awayName: "Beta", startTime: new Date(), status: "pre",
    };
    const { quotes } = buildFootballQuotes(
      ctx, stats(22, 8), stats(9, 20),
      { home: 1.85, draw: 3.4, away: 4.1, over: 1.9, under: 1.9, totalLine: 2.5 },
    );
    expect(quotes.length).toBeGreaterThan(10);
    for (const q of quotes) {
      // honest margin formula, no nudge:
      const honest = marginPrice(q.trueProb, BOOK_MARGIN.football);
      expect(q.price).toBeCloseTo(honest, 2);
      expect(q.price).toBeLessThanOrEqual(1 / (q.trueProb * 1.04));
      expect(q.price).toBeGreaterThan(1.01);
    }
  });

  it("every price derives EXACTLY from the honest margin formula (no clamps)", () => {
    const ctx = {
      id: "m2", sport: "football" as const, league: "Test League", leagueCode: "eng.1",
      homeName: "Alpha", awayName: "Gamma", startTime: new Date(), status: "pre",
    };
    const { quotes } = buildFootballQuotes(ctx, stats(18, 10), stats(11, 14), null);
    for (const q of quotes) {
      const honest = marginPrice(q.trueProb, BOOK_MARGIN.football);
      // price is never a hand-set constant: it must equal 1/(trueProb × 1.055)
      expect(q.price).toBeCloseTo(honest, 2);
      // and a collision with any fixed constant carries no meaning — formula rules:
      expect(q.price).toBe(Math.round((1 / (q.trueProb * 1.055)) * 100) / 100);
    }
  });

  it("shin de-vig sums to 1 and is more honest than proportional for favourite", () => {
    const p = shinDevig([2.0, 3.3, 3.8]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(p[0]).toBeGreaterThan(0.45);
  });
});

describe("Invariant 4 — whitelist & zero related contingency", () => {
  it("catalogue entries are consistent and assertions work", () => {
    expect(MARKET_WHITELIST.length).toBeGreaterThanOrEqual(32);
    expect(assertMarketAllowed("1x2", "HOME")).toBe(true);
    expect(assertMarketAllowed("1x2", "OVER")).toBe(false);
    expect(assertMarketAllowed("unknown_market", "YES")).toBe(false);
    expect(getMarket("btts")?.selections).toEqual(["YES", "NO"]);
  });

  it("same-market duplicates can never multiply (related contingency guard)", () => {
    expect(assertNoRelatedContingency(["1x2", "1x2"])).toBe(false);
    expect(assertNoRelatedContingency(["btts", "btts"])).toBe(false);
    expect(assertNoRelatedContingency(["1x2", "ou_2.5", "ou_2.5"])).toBe(false);
    // different markets MAY combine only across DIFFERENT matches — enforced
    // by the pipeline (one anchor per match) — the key-level guard allows it:
    expect(assertNoRelatedContingency(["1x2", "btts"])).toBe(true);
  });

  it("generated quotes are always whitelisted marketKey+selection pairs", () => {
    const ctx = {
      id: "m3", sport: "football" as const, league: "Test League", leagueCode: "eng.1",
      homeName: "Alpha", awayName: "Beta", startTime: new Date(), status: "pre",
    };
    const stat = (gf: number, ga: number): TeamStat =>
      ({ name: "T", played: 10, won: 5, drawn: 2, lost: 3, goalsFor: gf, goalsAgainst: ga });
    const { quotes } = buildFootballQuotes(ctx, stat(15, 9), stat(12, 11),
      { home: 2.1, draw: 3.2, away: 3.6, over: 1.85, under: 1.95, totalLine: 2.5 });
    for (const q of quotes) {
      expect(assertMarketAllowed(q.marketKey, q.selection)).toBe(true);
    }
  });
});

describe("Invariant 5 — cold-start bootstrap auto-ingest", () => {
  it("empty DB triggers AUTO_INGEST decision", () => {
    expect(resolveBootstrapAction(0, null)).toBe("AUTO_INGEST");
    expect(resolveBootstrapAction(12, new Date())).toBe("OK");
    expect(resolveBootstrapAction(12, new Date(Date.now() - 60 * 60_000))).toBe("REFRESH_STALE");
  });

  it("runIngest with fixture feed → bootstrapState returns NON-EMPTY arrays", async () => {
    const now = new Date();
    const pack: GatheredPack = {
      fetchedAt: now,
      degraded: false,
      notes: ["fixture"],
      standings: {},
      liveOdds: new Map(),
      football: [
        {
          espnEventId: "fx-1", sport: "football", league: "Test League", leagueCode: "eng.1",
          homeName: "Alpha", awayName: "Beta", startTime: new Date(now.getTime() + 3600_000),
          status: "pre",
          refOdds: { home: 1.85, draw: 3.4, away: 4.1, over: 1.9, under: 1.9, totalLine: 2.5 },
        },
        {
          espnEventId: "fx-2", sport: "football", league: "Test League", leagueCode: "eng.1",
          homeName: "Alpha", awayName: "Gamma", startTime: new Date(now.getTime() - 7200_000),
          status: "post", homeScore: 2, awayScore: 1,
        },
      ],
      tennis: [
        {
          espnEventId: "fx-3", sport: "tennis", league: "ATP · Test Masters", leagueCode: "atp",
          homeName: "Alpha", awayName: "Beta", homeRank: 8, awayRank: 44,
          startTime: new Date(now.getTime() + 7200_000), status: "pre", surface: "Hard",
        },
      ],
    };
    const summary = await runIngest({ feed: pack });
    expect(summary.matchesUpserted).toBe(3);
    expect(summary.quotesUpserted).toBeGreaterThan(0);
    const state = await bootstrapState();
    expect(state.matches.length).toBeGreaterThan(0);
    expect(state.matches.some((m) => m.quotes.length > 0)).toBe(true);
    expect(state.metrics.bankroll).toBeCloseTo(1000, 6);
  });
});
