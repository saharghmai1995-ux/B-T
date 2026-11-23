/**
 * NBA Feed (v3.3 §4) — 100% free, keyless ESPN endpoints:
 *   • scoreboard  https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD
 *   • standings   https://site.api.espn.com/apis/v2/sports/basketball/nba/standings
 * Zero-Mock: post events carry REAL final scores; pre events carry REAL
 * tip-off times. An outage returns an empty pack — never synthetic data.
 * Rest/B2B features are derived from the REAL schedule inside the fetched
 * window; star-out is ALWAYS false (no free reliable injury feed → no claim).
 */

import type { FeedMatch } from "@/core/types";

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_V2 = "https://site.api.espn.com/apis/v2/sports";

export const NBA_LEAGUE_CODE = "nba";
export const NBA_LEAGUE_NAME = "NBA";

export interface NbaTeamRating {
  team: string;
  /** ESPN standings "differential" stat — real per-game point differential. */
  differential: number;
  winPercent: number;
  wins: number;
  losses: number;
}

async function fetchJson(url: string, timeoutMs = 5000): Promise<unknown | null> {
  // Same hard 5s ceiling as espn-history (v2.7.2) — a hung ESPN response can
  // never stall bootstrap / ingest.
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

const compactDay = (d: Date): string => d.toISOString().slice(0, 10).replaceAll("-", "");

export const nbaDayKey = (daysBack: number): string =>
  compactDay(new Date(Date.now() - daysBack * 86400_000));

const evState = (e: Record<string, unknown>): string => {
  const comp = (e.competitions as Array<Record<string, unknown>> | undefined)?.[0];
  return ((comp?.status as Record<string, unknown> | undefined)?.type as Record<string, unknown> | undefined)
    ?.state as string ?? "pre";
};

const scoreOf = (c?: Record<string, unknown>): number | null => {
  const s = c?.score as { value?: number } | string | undefined;
  if (typeof s === "object") return s?.value ?? null;
  return s != null && s !== "" ? Number(s) : null;
};

function parseNbaEvent(e: Record<string, unknown>): FeedMatch | null {
  const comp = (e.competitions as Array<Record<string, unknown>> | undefined)?.[0];
  const comps = comp?.competitors as Array<Record<string, unknown>> | undefined;
  if (!comps || comps.length < 2) return null;
  const home = comps.find((c) => c.homeAway === "home");
  const away = comps.find((c) => c.homeAway === "away");
  const homeName = ((home?.team as Record<string, unknown>)?.displayName as string) ?? "";
  const awayName = ((away?.team as Record<string, unknown>)?.displayName as string) ?? "";
  if (!homeName || !awayName) return null;
  const status = evState(e);
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  if (status === "post") {
    homeScore = scoreOf(home);
    awayScore = scoreOf(away);
    if (homeScore == null || awayScore == null) return null;
  }
  return {
    espnEventId: String(e.id),
    sport: "basketball",
    league: NBA_LEAGUE_NAME,
    leagueCode: NBA_LEAGUE_CODE,
    homeName,
    awayName,
    startTime: new Date(e.date as string),
    status,
    homeScore,
    awayScore,
    homeLogo: ((home?.team as Record<string, unknown>)?.logo as string) ?? null,
    awayLogo: ((away?.team as Record<string, unknown>)?.logo as string) ?? null,
    venue: ((comp?.venue as Record<string, unknown>)?.fullName as string) ?? null,
    refOdds: null,
  };
}

/** One NBA scoreboard day — post + pre events (caller filters by state). */
export async function fetchNbaDay(day: string, timeoutMs = 5000): Promise<FeedMatch[]> {
  const j = await fetchJson(`${ESPN_SITE}/basketball/nba/scoreboard?dates=${day}`, timeoutMs);
  if (!j) return [];
  const events = (j as { events?: Array<Record<string, unknown>> }).events ?? [];
  const out: FeedMatch[] = [];
  for (const e of events) {
    const m = parseNbaEvent(e);
    if (m) out.push(m);
  }
  return out;
}

/** Backfill window — finished NBA fixtures from the past `days` days. */
export async function fetchNbaPastRange(daysBack: number, daysBackEnd = 1): Promise<FeedMatch[]> {
  const out: FeedMatch[] = [];
  for (let d = daysBack; d >= daysBackEnd; d--) {
    const day = await fetchNbaDay(nbaDayKey(d));
    for (const m of day) {
      if (m.status === "post") out.push(m);
    }
  }
  return out;
}

/** Live feed — today + tomorrow pre games (the NBA daily calendar). */
export async function fetchNbaUpcoming(): Promise<FeedMatch[]> {
  const today = await fetchNbaDay(nbaDayKey(0));
  const tomorrow = await fetchNbaDay(nbaDayKey(-1)); // tomorrow = "-1 days back"
  const out = [...today, ...tomorrow].filter((m) => m.status === "pre");
  return out;
}

/** REAL current standings → per-game point differential (NetRtg proxy). */
export async function fetchNbaStandings(): Promise<NbaTeamRating[]> {
  const j = await fetchJson(`${ESPN_V2}/basketball/nba/standings`);
  if (!j) return [];
  const out: NbaTeamRating[] = [];
  const children = (j as { children?: Array<Record<string, unknown>> }).children ?? [];
  for (const child of children) {
    const entries =
      ((child.standings as Record<string, unknown> | undefined)?.entries as
        | Array<Record<string, unknown>>
        | undefined) ?? [];
    for (const entry of entries) {
      const teamName = ((entry.team as Record<string, unknown> | undefined)?.displayName as string) ?? "";
      if (!teamName) continue;
      let differential: number | null = null;
      let winPercent = 0;
      let wins = 0;
      let losses = 0;
      for (const s of (entry.stats as Array<Record<string, unknown>> | undefined) ?? []) {
        const name = s.name as string;
        const v = s.value;
        if (name === "differential" && typeof v === "number") differential = v;
        else if (name === "winPercent" && typeof v === "number") winPercent = v;
        else if (name === "wins" && typeof v === "number") wins = v;
        else if (name === "losses" && typeof v === "number") losses = v;
      }
      if (differential == null) continue;
      out.push({ team: teamName, differential, winPercent, wins, losses });
    }
  }
  return out;
}

/**
 * REAL schedule window → per-team most recent finished game (for B2B and
 * rest-day derivation). Returns map: normalized team name → last game date.
 */
export async function fetchNbaLastGameMap(daysBack = 3): Promise<Map<string, Date>> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const last = new Map<string, Date>();
  for (let d = 1; d <= daysBack; d++) {
    const day = await fetchNbaDay(nbaDayKey(d));
    for (const m of day) {
      if (m.status !== "post") continue;
      for (const team of [m.homeName, m.awayName]) {
        const k = norm(team);
        const prev = last.get(k);
        if (!prev || m.startTime > prev) last.set(k, m.startTime);
      }
    }
  }
  return last;
}

/** B2B / rest-days from the REAL schedule map (neutral defaults when absent). */
export function nbaScheduleFeatures(
  team: string,
  gameStart: Date,
  lastGameMap: Map<string, Date>,
): { backToBack: boolean; restDays: number } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const last = lastGameMap.get(norm(team));
  if (!last) return { backToBack: false, restDays: 7 }; // no data → neutral, never invented
  const restMs = gameStart.getTime() - last.getTime();
  const restDays = Math.floor(restMs / 86400_000);
  return { backToBack: restDays <= 1 && restMs >= 0, restDays: Math.max(0, restDays) };
}
