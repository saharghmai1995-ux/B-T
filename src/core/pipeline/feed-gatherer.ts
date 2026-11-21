/**
 * Feed Gatherer — assembles the full live pack from the network boundary.
 * Football 19 leagues + tennis ATP/WTA + season standings + optional 1xBet live.
 */

import type { FeedMatch, FeedPack, TeamStat } from "@/core/types";
import {
  fetchFootballFeed, fetchFootballStandings, fetchTennisFeed,
  fetchLive1xBetOdds, FOOTBALL_LEAGUES, type LiveOddsRow,
} from "@/core/bookmakers/odds-feed";
import { getSetting, SETTING_KEYS } from "./settings";

export interface GatheredPack extends FeedPack {
  standings: Record<string, TeamStat[]>;
  liveOdds: Map<string, LiveOddsRow>;
}

export async function gatherFeed(): Promise<GatheredPack> {
  const notes: string[] = [];
  const [football, tennis] = await Promise.all([
    fetchFootballFeed(), fetchTennisFeed(),
  ]);
  if (football.length === 0) notes.push("ESPN football scoreboard unreachable this run");
  if (tennis.length === 0) notes.push("ESPN tennis scoreboard unreachable this run");

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

  const apiKey = await getSetting(SETTING_KEYS.oddsApiKey);
  const liveOdds = await fetchLive1xBetOdds(apiKey || null);
  if (apiKey) notes.push(`The Odds API live rows: ${liveOdds.size}`);
  else notes.push("No The Odds API key — 1xBet prices run in honest ESTIMATE mode");

  return {
    fetchedAt: new Date(),
    football, tennis,
    degraded: football.length === 0 && tennis.length === 0,
    notes,
    standings,
    liveOdds,
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
