/**
 * Settlement Engine — auto-settles finished fixtures (ESPN post state).
 * Football settles on 90-minute regular time; tennis on full match
 * completion with retirement voided at 1.00. Zero contradictions: the same
 * resolver drives every market kind from the whitelist.
 * v2.5 STAKING: settlement NEVER invents stakes — every row settles at the
 * stake locked on its signal (Quarter-Kelly 1%–3.5% of bank at issue time,
 * unified by src/core/math/kelly.ts calculateSafeQuarterKellyStake).
 */

import type { SettledRow } from "@/core/types";
import { settleNetProfit, statusFromProfit } from "./ledger-service";
import { round2 } from "@/core/math/devig";
import { resolveNbaSelection } from "@/engines/nba/nba-selector";

export interface FixtureResult {
  sport: string;
  homeScore: number;
  awayScore: number;
  retired: boolean;
  detail?: string | null;
}

export type SettleVerdict = { status: "WON" | "LOST" | "VOID"; factor: number };

/**
 * Resolve one whitelisted selection against a final score.
 * marketKey@selection is the same vocabulary the selectors issued.
 * factor: 1 = full settle, 0.5 = quarter-line half win (honest half stake).
 */
export function resolveSelection(key: string, sel: string, r: FixtureResult): SettleVerdict {
  // v3.3 — NBA (basketball) resolution: no draws, OT final scores are REAL
  // totals; ML requires a strict win, +4.5 alt spread covers with any loss ≤4.
  if (r.sport === "basketball") return { status: resolveBasketball(key, sel, r), factor: 1 };
  if (r.sport === "tennis") return { status: resolveTennis(key, sel, r), factor: 1 };
  const h = r.homeScore, a = r.awayScore;
  const total = h + a;
  const res = h > a ? "HOME" : h < a ? "AWAY" : "DRAW";
  switch (key) {
    case "1x2":
      return { status: sel === res ? "WON" : "LOST", factor: 1 };
    case "dc_1x":
      return { status: res === "HOME" || res === "DRAW" ? "WON" : "LOST", factor: 1 };
    case "dc_x2":
      return { status: res === "AWAY" || res === "DRAW" ? "WON" : "LOST", factor: 1 };
    case "dnb":
      if (res === "DRAW") return { status: "VOID", factor: 1 };
      return { status: sel === res ? "WON" : "LOST", factor: 1 };
    case "ah_home_-0.5":
      return { status: h - a > 0.5 ? "WON" : "LOST", factor: 1 };
    case "ah_home_-0.75": {
      const m = h - a; // split -0.5 / -1.0
      if (m >= 2) return { status: "WON", factor: 1 };
      if (m === 1) return { status: "WON", factor: 0.5 }; // half win, half push
      return { status: "LOST", factor: 1 };
    }
    case "ah_home_-1.0":
      if (h - a >= 2) return { status: "WON", factor: 1 };
      if (h - a === 1) return { status: "VOID", factor: 1 }; // push
      return { status: "LOST", factor: 1 };
    case "ah_away_-0.5":
      return { status: a - h > 0.5 ? "WON" : "LOST", factor: 1 };
    case "ah_away_-0.75": {
      const m = a - h;
      if (m >= 2) return { status: "WON", factor: 1 };
      if (m === 1) return { status: "WON", factor: 0.5 };
      return { status: "LOST", factor: 1 };
    }
    case "ah_away_-1.0":
      if (a - h >= 2) return { status: "WON", factor: 1 };
      if (a - h === 1) return { status: "VOID", factor: 1 };
      return { status: "LOST", factor: 1 };
    case "ou_1.5":
    case "ou_2.5":
    case "ou_3.5": {
      const line = Number(key.slice(3));
      if (total === line) return { status: "VOID", factor: 1 };
      return { status: (sel === "OVER") === total > line ? "WON" : "LOST", factor: 1 };
    }
    case "btts":
      return { status: (sel === "YES") === (h > 0 && a > 0) ? "WON" : "LOST", factor: 1 };
    case "tt_home_o1.5":
      return { status: h > 1.5 ? "WON" : "LOST", factor: 1 };
    case "tt_away_o1.5":
      return { status: a > 1.5 ? "WON" : "LOST", factor: 1 };
    case "combo_1x_u3.5":
      return { status: (res === "HOME" || res === "DRAW") && total < 3.5 ? "WON" : "LOST", factor: 1 };
    case "combo_home_o1.5":
      return { status: res === "HOME" && h > 1.5 && total > 1.5 ? "WON" : "LOST", factor: 1 };
    // v3.1 Push-Shield markets — same honest settlement vocabulary.
    case "DNB_AH0": {
      if (res === "DRAW") return { status: "VOID", factor: 1 };
      const favIsHome = sel === "HOME";
      return { status: (favIsHome && res === "HOME") || (!favIsHome && res === "AWAY") ? "WON" : "LOST", factor: 1 };
    }
    case "AH_PLUS_025": {
      // Split AH 0/0.25: win → full; draw → half win, half push (factor 0.5);
      // loss → lost. Selection encodes the side: HOME_+0.25 | AWAY_+0.25.
      const favIsHome = sel.startsWith("HOME");
      const favWon = favIsHome ? res === "HOME" : res === "AWAY";
      const favLost = favIsHome ? res === "AWAY" : res === "HOME";
      if (favWon) return { status: "WON", factor: 1 };
      if (favLost) return { status: "LOST", factor: 1 };
      return { status: "WON", factor: 0.5 }; // draw = half win + half push
    }
    case "DOUBLE_CHANCE": {
      const won = sel === "1X" ? res === "HOME" || res === "DRAW" : res === "AWAY" || res === "DRAW";
      return { status: won ? "WON" : "LOST", factor: 1 };
    }
    case "OVER_2_0":
      if (total === 2) return { status: "VOID", factor: 1 }; // push on exactly 2
      return { status: total > 2 ? "WON" : "LOST", factor: 1 };
    case "UNDER_3_0":
      if (total === 3) return { status: "VOID", factor: 1 }; // push on exactly 3
      return { status: total < 3 ? "WON" : "LOST", factor: 1 };
    default:
      return { status: "VOID", factor: 1 };
  }
}

/**
 * v3.3.2 §1 — NBA engine resolution (real-bookmaker vocabulary).
 * Whole-number favourite/underdog handicaps (NBA_HCP_-2/-3/+5/+6) settle
 * through `resolveNbaSelection` with an HONEST PUSH verdict (exact-margin
 * win/loss returns the stake — VOID at 1.00, never a fake result). The legacy
 * v3.3/v3.3.1 vocabulary (1X2 / NBA_ALT_SPREAD +4.5) is still honoured so
 * already-settled ledger rows never flip status; a half-point +4.5 line can
 * never push.
 */
const mapNbaPush = (v: "WON" | "PUSH" | "LOST"): SettleVerdict["status"] =>
  v === "PUSH" ? "VOID" : v;

function resolveBasketball(key: string, sel: string, r: FixtureResult): SettleVerdict["status"] {
  const h = r.homeScore, a = r.awayScore;
  if (h == null || a == null) return "VOID";
  switch (key) {
    case "NBA_ML":
    case "1X2": // legacy v3.3 rows
      if (sel === "NBA_ML_HOME" || sel === "NBA_ML_AWAY") return mapNbaPush(resolveNbaSelection(sel, h, a));
      return "VOID";
    case "NBA_HCP_MINUS_2":
    case "NBA_HCP_MINUS_3":
    case "NBA_HCP_PLUS_5":
    case "NBA_HCP_PLUS_6":
    case "NBA_ALT_SPREAD": // legacy v3.3.1 rows
    case "AH_PLUS_025": // legacy v3.3 rows
      if (sel.startsWith("NBA_HCP_") || sel.startsWith("NBA_ALT_+4.5")) {
        return mapNbaPush(resolveNbaSelection(sel, h, a));
      }
      return "VOID";
    default:
      return "VOID";
  }
}

function resolveTennis(key: string, sel: string, r: FixtureResult): SettleVerdict["status"] {
  const setsA = r.homeScore, setsB = r.awayScore;
  // v3.3.2 §4.2 — retirement (ret / w/o) settlement rules, patch-exact:
  //   • TENNIS_SET_PLUS_15 — if the SELECTED player won at least 1 set before
  //     the retirement (e.g. "6-2, 2-0 ret") → WON; otherwise PUSH (stake
  //     returned, VOID). A retirement can NEVER settle +1.5 as LOST again.
  //   • TENNIS_ML + every other market — match not completed → stake
  //     returned (VOID at 1.00); a half-finished match is never a result.
  //   Defense in depth: the retirement is detected from BOTH the feed flag
  //   and the stored result string ("… 0-0 ret" rows the feed flag missed).
  const retired =
    r.retired || /\b(ret\.?|retired|walkover|w\/o)\b/i.test(r.detail ?? "");
  if (retired) {
    if (key === "TENNIS_SET_PLUS_15") {
      const isHome = sel.startsWith("HOME");
      const sideSets = isHome ? setsA : setsB;
      return (sideSets ?? 0) >= 1 ? "WON" : "VOID";
    }
    return "VOID";
  }
  const winner = setsA > setsB ? "HOME" : setsB > setsA ? "AWAY" : null;
  if (!winner) return "VOID";
  switch (key) {
    case "winner":
      return sel === winner ? "WON" : "LOST";
    case "setbet_2_0": {
      const won = winner === sel && (sel === "HOME" ? setsA === 2 && setsB === 0 : setsB === 2 && setsA === 0);
      return won ? "WON" : "LOST";
    }
    case "setbet_2_1": {
      const won = winner === sel && (sel === "HOME" ? setsA === 2 && setsB === 1 : setsB === 2 && setsA === 1);
      return won ? "WON" : "LOST";
    }
    case "tot_sets_o2.5": {
      const t = setsA + setsB;
      if (t === 2.5) return "VOID";
      return (sel === "OVER") === t > 2.5 ? "WON" : "LOST";
    }
    case "sethand_home_-1.5":
      return setsA - setsB > 1.5 ? "WON" : "LOST";
    case "sethand_home_+1.5":
      return setsA + 1.5 > setsB ? "WON" : "LOST";
    case "sethand_away_-1.5":
      return setsB - setsA > 1.5 ? "WON" : "LOST";
    case "sethand_away_+1.5":
      return setsB + 1.5 > setsA ? "WON" : "LOST";
    case "tot_games_o20.5":
    case "tot_games_o21.5":
    case "tot_games_o22.5": {
      // Games come from the detail string (e.g. "6-4 3-6 6-1").
      const games = gamesFromDetail(r.detail);
      if (games == null) return "VOID";
      const line = Number(key.slice(12));
      return (sel === "OVER") === games > line ? "WON" : "LOST";
    }
    case "gamehand_home_-3.5":
    case "gamehand_home_+3.5":
    case "gamehand_away_-3.5":
    case "gamehand_away_+3.5": {
      const games = gamesFromDetail(r.detail);
      if (games == null) return "VOID";
      const ga = gamesFromDetail(r.detail, "A") ?? 0;
      const gb = gamesFromDetail(r.detail, "B") ?? 0;
      const m = key.includes("home") ? ga - gb : gb - ga;
      const line = Number(key.split("_").pop()?.replace("+", "") ?? "0");
      return m + line > 0 ? "WON" : "LOST";
    }
    // v3.1 Push-Shield tennis markets.
    case "TENNIS_ML":
      return sel === winner ? "WON" : "LOST";
    case "TENNIS_SET_PLUS_15": {
      // selection: HOME_+1.5 | AWAY_+1.5 — covers when that side wins ≥1 set.
      const isHome = sel.startsWith("HOME");
      const sideSets = isHome ? setsA : setsB;
      return sideSets + 1.5 > (isHome ? setsB : setsA) ? "WON" : "LOST";
    }
    case "TENNIS_GAME_HCP": {
      // selection: HOME_±3.5 | AWAY_±3.5 — games margin vs the line.
      const games = gamesFromDetail(r.detail);
      if (games == null) return "VOID";
      const ga = gamesFromDetail(r.detail, "A") ?? 0;
      const gb = gamesFromDetail(r.detail, "B") ?? 0;
      const isHome = sel.startsWith("HOME");
      const lineRaw = sel.split("_").pop()?.replace("+", "") ?? "0";
      const line = Number(lineRaw);
      const m = isHome ? ga - gb : gb - ga;
      return m + line > 0 ? "WON" : "LOST";
    }
    default:
      return "VOID";
  }
}

/** Parse total games (or per-player) from a set-score detail string. */
export function gamesFromDetail(detail: string | null | undefined, side?: "A" | "B"): number | null {
  if (!detail) return null;
  const sets = detail.match(/\d+-\d+(\s*\(\d+\))?/g);
  if (!sets || sets.length === 0) return null;
  let a = 0, b = 0;
  for (const s of sets) {
    const m = s.match(/(\d+)-(\d+)/);
    if (!m) continue;
    a += Number(m[1]);
    b += Number(m[2]);
  }
  if (side === "A") return a;
  if (side === "B") return b;
  return a + b;
}

/** Settle one row honestly and return the ledger fields to persist. */
export function settleRow(row: SettledRow, r: FixtureResult): {
  status: SettledRow["status"];
  netProfit: number;
  settledAt: Date;
} {
  const v = resolveSelection(row.marketKey, row.selection, r);
  const netProfit = round2(settleNetProfit(v.status, row.stake * v.factor, row.price));
  const status = statusFromProfit(netProfit, v.status);
  return { status, netProfit, settledAt: new Date() };
}
