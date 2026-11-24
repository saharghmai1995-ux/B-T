/**
 * ESPN History Feed — real finished fixtures from past scoreboard dates.
 * Same network boundary + parsing vocabulary as odds-feed.ts, but pointed at
 * PAST dates so the cold-start ledger can settle against REAL final scores.
 * No synthetic scores, no synthetic teams — ESPN post-state only.
 */

import type { FeedMatch } from "@/core/types";
import { americanToDecimal } from "@/core/math/devig";
import { FOOTBALL_LEAGUES, LEAGUE_NAMES as LEAGUE_NAMES_FALLBACK } from "./odds-feed";

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";

export interface HistoryPack {
  football: FeedMatch[];
  tennis: FeedMatch[];
  notes: string[];
}

async function fetchJson(url: string, timeoutMs = 5000): Promise<unknown | null> {
  // v2.7.2 hotfix — hard 5s ceiling (AbortSignal.timeout) so a hung ESPN
  // response can never stall the cold-start backfill / bootstrap pipeline.
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

const compactDay = (d: Date): string =>
  d.toISOString().slice(0, 10).replaceAll("-", "");

export const pastDayKey = (daysBack: number): string =>
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

function parseSoccerPast(e: Record<string, unknown>, leagueCode: string): FeedMatch | null {
  const comp = (e.competitions as Array<Record<string, unknown>>)[0];
  const comps = comp.competitors as Array<Record<string, unknown>>;
  if (!comps || comps.length < 2) return null;
  const home = comps.find((c) => c.homeAway === "home");
  const away = comps.find((c) => c.homeAway === "away");
  const homeName = ((home?.team as Record<string, unknown>)?.displayName as string) ?? "";
  const awayName = ((away?.team as Record<string, unknown>)?.displayName as string) ?? "";
  if (!homeName || !awayName) return null;
  const status = evState(e);
  if (status !== "post") return null;
  const homeScore = scoreOf(home), awayScore = scoreOf(away);
  if (homeScore == null || awayScore == null) return null;
  return {
    espnEventId: String(e.id), sport: "football",
    league: LEAGUE_NAMES_FALLBACK[leagueCode] ?? leagueCode, leagueCode,
    homeName, awayName, startTime: new Date(e.date as string), status,
    homeScore, awayScore,
    homeLogo: ((home?.team as Record<string, unknown>)?.logo as string) ?? null,
    awayLogo: ((away?.team as Record<string, unknown>)?.logo as string) ?? null,
    venue: ((comp.venue as Record<string, unknown>)?.fullName as string) ?? null,
    refOdds: null,
  };
}

/** One league, one past day (soccer scoreboard accepts a single date). */
export async function fetchFootballPastDay(day: string, leagues: readonly string[]): Promise<FeedMatch[]> {
  const out: FeedMatch[] = [];
  const CHUNK = 6;
  for (let i = 0; i < leagues.length; i += CHUNK) {
    const slice = leagues.slice(i, i + CHUNK);
    const packs = await Promise.all(
      slice.map(async (lg) => ({
        lg,
        j: await fetchJson(`${ESPN_SITE}/soccer/${lg}/scoreboard?dates=${day}`),
      })),
    );
    for (const { lg, j } of packs) {
      if (!j) continue;
      const events = (j as { events?: Array<Record<string, unknown>> }).events ?? [];
      for (const e of events) {
        const m = parseSoccerPast(e, lg);
        if (m) out.push(m);
      }
    }
    if (i + CHUNK < leagues.length) await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

function parseTennisPast(e: Record<string, unknown>, tour: "atp" | "wta"): FeedMatch[] {
  const out: FeedMatch[] = [];
  const eventName = (e.name as string) ?? "";
  for (const g of (e.groupings as Array<Record<string, unknown>> | undefined) ?? []) {
    const slug = String((g.grouping as Record<string, unknown>)?.slug ?? "");
    if (!/singles/.test(slug)) continue;
    for (const comp of (g.competitions as Array<Record<string, unknown>>) ?? []) {
      // Status lives on the COMPETITION for tennis (event-level can be misleading).
      const compState = ((comp.status as Record<string, unknown> | undefined)?.type as Record<string, unknown> | undefined)?.state as string | undefined;
      const state = compState ?? evState(e);
      if (state !== "post") continue;
      const cs = comp.competitors as Array<Record<string, unknown>>;
      if (!cs || cs.length < 2) continue;
      const nm = (c: Record<string, unknown>) =>
        ((c.athlete as Record<string, unknown>)?.displayName as string) ?? "";
      const a = nm(cs[0]), b = nm(cs[1]);
      if (!a || !b || a === "TBD" || b === "TBD") continue;
      const winnerIdx = cs.findIndex((c) => c.winner === true);
      if (winnerIdx < 0) continue;
      const rankOf = (c: Record<string, unknown>) =>
        ((c.curatedRank as Record<string, unknown> | undefined)?.current as number | undefined) ?? null;
      const flagOf = (c: Record<string, unknown>) => {
        const athlete = (c.athlete as Record<string, unknown> | undefined) ?? {};
        const flag = athlete.flag;
        const href = typeof flag === "string" ? flag : ((flag as { href?: string } | undefined)?.href ?? null);
        return href ?? ((athlete.headshot as string) ?? null);
      };
      const setsOf = (c: Record<string, unknown>) =>
        ((c.linescores as Array<{ value?: number }> | undefined) ?? []).map((l) => Number(l.value ?? 0));
      const sa = setsOf(cs[0]), sb = setsOf(cs[1]);
      const detail = sa.length && sa.length === sb.length
        ? sa.map((v, i) => `${v}-${sb[i]}`).join(" ")
        : null;
      const notes = ((comp.notes as Array<{ text?: string }> | undefined) ?? []).map((n) => n.text ?? "").join(" ");
      // v3.3.2 §4.2 — retirement detection widened to the patch vocabulary
      // ("ret" / "w/o" / walkover / retired): the old `ret\.`-only regex
      // missed the common "… 0-0 ret" ESPN notes and mis-settled +1.5 sets.
      const retired = /\b(ret\.?|retired|walkover|w\/o)\b/i.test(notes) ? true : false;
      // Real set scores from per-set linescores (3-setters → 2-1, not 2-0).
      let setsA = 0, setsB = 0;
      if (sa.length && sa.length === sb.length) {
        for (let i = 0; i < sa.length; i++) {
          if (sa[i] > sb[i]) setsA++;
          else if (sb[i] > sa[i]) setsB++;
        }
      }
      const setScoreHome = setsA + setsB > 0 ? setsA : winnerIdx === 0 ? 2 : 0;
      const setScoreAway = setsA + setsB > 0 ? setsB : winnerIdx === 1 ? 2 : 0;
      out.push({
        espnEventId: String(comp.id), sport: "tennis",
        league: `${tour.toUpperCase()} · ${eventName}`, leagueCode: tour,
        homeName: a, awayName: b, homeRank: rankOf(cs[0]), awayRank: rankOf(cs[1]),
        homeLogo: flagOf(cs[0]), awayLogo: flagOf(cs[1]),
        startTime: new Date((comp.date as string) ?? (e.date as string)), status: "post",
        homeScore: setScoreHome, awayScore: setScoreAway,
        detail: notes || detail, round: (e.shortName as string) ?? null,
        venue: ((comp.venue as Record<string, unknown>)?.fullName as string) ?? null,
        retired,
      });
    }
  }
  return out;
}

/** Tennis past range — the tennis scoreboard accepts a from-to date range. */
export async function fetchTennisPastRange(fromDaysBack: number, toDaysBack: number): Promise<FeedMatch[]> {
  const range = `${pastDayKey(fromDaysBack)}-${pastDayKey(toDaysBack)}`;
  const jobs = (["atp", "wta"] as const).map(async (tour) => {
    const j = await fetchJson(`${ESPN_SITE}/tennis/${tour}/scoreboard?dates=${range}`);
    if (!j) return [] as FeedMatch[];
    const events = (j as { events?: Array<Record<string, unknown>> }).events ?? [];
    return events.flatMap((e) => parseTennisPast(e, tour));
  });
  return (await Promise.all(jobs)).flat();
}

export interface HistoryRefOdds {
  home: number;
  draw?: number;
  away: number;
  over?: number;
  under?: number;
  totalLine?: number;
}

const dec = (am: unknown): number | undefined => {
  const n = Number(am);
  return Number.isFinite(n) && n !== 0 ? americanToDecimal(n) : undefined;
};

/**
 * REAL closing reference odds for a finished fixture — ESPN summary
 * `pickcenter` (DraftKings provider). This is the honest market anchor that
 * lets the historical Dixon-Coles 65/35 blend diverge from the market and
 * produce genuine +EV singles exactly like the live pipeline does.
 */
export async function fetchFootballSummaryOdds(leagueCode: string, espnEventId: string): Promise<HistoryRefOdds | null> {
  const j = await fetchJson(`${ESPN_SITE}/soccer/${leagueCode}/summary?event=${espnEventId}`, 9000);
  if (!j) return null;
  const root = j as Record<string, unknown>;
  const pc = (root.pickcenter as Array<Record<string, unknown>> | undefined) ?? [];
  const o = pc[0];
  if (!o) return null;
  const ml = (side: string) => {
    const t = o[side] as Record<string, unknown> | undefined;
    return dec(t?.moneyLine);
  };
  const home = ml("homeTeamOdds"), away = ml("awayTeamOdds"), draw = ml("drawOdds");
  const totalLine = typeof o.overUnder === "number" ? o.overUnder : undefined;
  const over = dec(o.overOdds), under = dec(o.underOdds);
  if (!home || !away) return null;
  return {
    home, away, draw,
    over: over && under ? over : undefined,
    under: over && under ? under : undefined,
    totalLine,
  };
}
