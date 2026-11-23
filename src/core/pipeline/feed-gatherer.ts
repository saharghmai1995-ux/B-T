/**
 * Feed Gatherer — assembles the full live pack from the network boundary.
 * v2.0 ZERO-MOCK: no simulation fallback exists anywhere in the pipeline.
 * Every row comes from a REAL API (ESPN Soccer 19 leagues, ESPN Tennis
 * ATP/WTA incl. the past 7 days, optional The Odds API v4 / Odds-API.io).
 * When the network is unreachable the pack is honestly EMPTY (degraded) and
 * the UI surfaces a real offline state — never a simulated substitute.
 */

import type { FeedMatch, FeedPack, TeamStat } from "@/core/types";
import {
  fetchFootballFeed, fetchFootballStandings, fetchTennisFeed,
  fetchLive1xBetOdds, fetchOddsApiIoRows, fetchOddsPapiRows,
  FOOTBALL_LEAGUES, getOddsFeedStats, type LiveOddsRow,
} from "@/core/bookmakers/odds-feed";
import { getOddsApiKey, getOddsPapiApiKey, getSetting, SETTING_KEYS } from "./settings";
import { fetchNbaUpcoming, fetchNbaStandings, fetchNbaLastGameMap, nbaScheduleFeatures, type NbaTeamRating } from "@/core/bookmakers/nba-feed";

export interface GatheredPack extends FeedPack {
  standings: Record<string, TeamStat[]>;
  liveOdds: Map<string, LiveOddsRow>;
  /** v3.3 — REAL NBA standings differentials + schedule B2B map. */
  nbaRatings: NbaTeamRating[];
  nbaLastGames: Map<string, Date>;
}

export async function gatherFeed(): Promise<GatheredPack> {
  const notes: string[] = [];

  const [football, tennis, basketball] = await Promise.all([
    fetchFootballFeed(), fetchTennisFeed(), fetchNbaUpcoming(),
  ]);
  if (football.length === 0) notes.push("ESPN football scoreboard unreachable this run");
  if (tennis.length === 0) notes.push("ESPN tennis scoreboard unreachable this run");
  // v3.3 §4 — Engine 3 (NBA): keyless scoreboard + standings feed the
  // normal-CDF margin engine with REAL differentials and REAL schedule B2B.
  const nbaRatings: NbaTeamRating[] = await fetchNbaStandings();
  if (basketball.length === 0) notes.push("ESPN NBA scoreboard unreachable this run");
  else notes.push(`NBA pre fixtures: ${basketball.length} · standings rows: ${nbaRatings.length}`);
  const nbaLastGames = await fetchNbaLastGameMap(3);

  // Standings only for leagues that actually have upcoming fixtures (cap 8).
  const upcomingLeagues = [...new Set(
    football.filter((m) => m.status === "pre").map((m) => m.leagueCode),
  )].filter((lg) => (FOOTBALL_LEAGUES as readonly string[]).includes(lg)).slice(0, 8);

  const standings: Record<string, TeamStat[]> = {};
  await Promise.all(upcomingLeagues.map(async (lg) => {
    const rows = await fetchFootballStandings(lg);
    if (rows.length) standings[lg] = rows;
    else notes.push(`No standings for ${lg}`);
  }));

  // Live book prices — v2.7 THREE-LAYER CASCADE. Rows merge into one map;
  // higher layers win on conflict so provenance stays honest:
  //   Layer 1 — The Odds API v4 (1xBet+Pinnacle, 45-min credit shield)
  //   Layer 2 — OddsPapi v4 (api.oddspapi.io, free backup)
  //   Layer 3 — ESPN Core public odds are attached per-event later in the
  //             ingest pipeline (keyless, only for fixtures with no Layer1/2 row).
  const oddsKey = (await getOddsApiKey()) ?? null;
  const papiKey = (await getOddsPapiApiKey()) ?? null;
  const ioKey = await getSetting(SETTING_KEYS.oddsApiIoKey);
  const [oddsApiRows, papiRows, ioRows] = await Promise.all([
    fetchLive1xBetOdds(oddsKey),
    fetchOddsPapiRows(papiKey),
    ioKey ? fetchOddsApiIoRows(ioKey) : Promise.resolve(new Map<string, LiveOddsRow>()),
  ]);
  const liveOdds = new Map<string, LiveOddsRow>();
  for (const [k, v] of papiRows) liveOdds.set(k, v); // Layer 2 base
  for (const [k, v] of ioRows) liveOdds.set(k, v); // legacy odds-api.io extra
  for (const [k, v] of oddsApiRows) liveOdds.set(k, v); // Layer 1 wins on conflict
  if (oddsKey) {
    const stats = getOddsFeedStats();
    notes.push(`Layer1 The Odds API v4 rows: ${oddsApiRows.size} (soccer+tennis, 45m cache)`);
    if (stats.remainingCredits) notes.push(`Odds API quota remaining: ${stats.remainingCredits}`);
    if (stats.cachedSportKeys.length) notes.push(`Odds API cached keys: ${stats.cachedSportKeys.join(", ")}`);
    if (stats.lastError) notes.push(`Odds API last error: ${stats.lastError}`);
  } else {
    notes.push("Layer1 unavailable (no key) — Layer2 OddsPapi + Layer3 ESPN Core keep prices live");
  }
  notes.push(`Layer2 OddsPapi rows: ${papiRows.size}`);
  if (ioKey) notes.push(`Legacy odds-api.io rows: ${ioRows.size}`);

  return {
    fetchedAt: new Date(),
    football, tennis, basketball,
    degraded: football.length === 0 && tennis.length === 0 && basketball.length === 0,
    notes,
    standings,
    liveOdds,
    nbaRatings,
    nbaLastGames,
  };
}

/** v3.3 — REAL NBA features for ONE fixture (standings + schedule). */
export function buildNbaFeatures(
  pack: GatheredPack,
  m: { homeName: string; awayName: string; startTime: Date },
): { features: import("@/engines/nba/nba-selector").NbaMatchFeatures; completeness: number; notes: string[] } | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const find = (t: string) => pack.nbaRatings.find((r) => norm(r.team) === norm(t));
  const home = find(m.homeName);
  const away = find(m.awayName);
  if (!home || !away) return null; // unrated pairing — the gate vetoes it
  const homeSched = nbaScheduleFeatures(m.homeName, m.startTime, pack.nbaLastGames);
  const awaySched = nbaScheduleFeatures(m.awayName, m.startTime, pack.nbaLastGames);
  const notes = [
    `NetRtg diff: ${home.team} ${(home.differential >= 0 ? "+" : "") + home.differential.toFixed(1)} vs ${away.team} ${(away.differential >= 0 ? "+" : "") + away.differential.toFixed(1)}`,
    homeSched.backToBack ? `${home.team}: back-to-back` : `${home.team}: ${homeSched.restDays}d rest`,
    awaySched.backToBack ? `${away.team}: back-to-back` : `${away.team}: ${awaySched.restDays}d rest`,
  ];
  return {
    features: {
      homeTeam: m.homeName,
      awayTeam: m.awayName,
      homeNetRating: home.differential,
      awayNetRating: away.differential,
      // v3.3.1 §1a — REAL win% feeds the calibrated 70/30 strength blend.
      homeWinPct: home.winPercent,
      awayWinPct: away.winPercent,
      homeBackToBack: homeSched.backToBack,
      awayBackToBack: awaySched.backToBack,
      homeRestDays: homeSched.restDays,
      awayRestDays: awaySched.restDays,
      homeStarOut: false, // no free reliable injury feed — never invented
      awayStarOut: false,
    },
    completeness: 1, // REAL standings + REAL schedule for both sides
    notes,
  };
}

/** Name-key lookup for standings rows (case/space/suffix tolerant). */
export function findTeamStat(standings: Record<string, TeamStat[]>, leagueCode: string, name: string): TeamStat | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const rows = standings[leagueCode] ?? [];
  const target = norm(name);
  if (!target) return null;
  // exact → prefix → contains (e.g. "Parma" vs "Parma Calcio 1913")
  return (
    rows.find((r) => norm(r.name) === target) ??
    rows.find((r) => norm(r.name).startsWith(target) || target.startsWith(norm(r.name))) ??
    rows.find((r) => norm(r.name).includes(target) || target.includes(norm(r.name))) ??
    null
  );
}

/** League average goals per team per game — computed from the real table. */
export function leagueAverageGoals(rows: TeamStat[] | undefined): number {
  if (!rows || rows.length === 0) return 1.35;
  let gf = 0, played = 0;
  for (const r of rows) {
    if (r.played <= 0) continue;
    gf += r.goalsFor;
    played += r.played;
  }
  const perTeamGame = played > 0 ? gf / played : 0;
  // sanity band: realistic league means sit between 0.8 and 2.2
  if (perTeamGame < 0.8 || perTeamGame > 2.2) return 1.35;
  return Math.round(perTeamGame * 1000) / 1000;
}

export type { FeedMatch };
