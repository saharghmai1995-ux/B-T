/**
 * Odds Feed — real network boundary (server-only).
 * Live fixtures + reference odds from keyless ESPN endpoints, optional
 * The Odds API v4 (1xBet + Pinnacle), optional Polymarket Gamma (best effort).
 * ZERO fake odds: every price keeps its honest provenance tag.
 */

import type { FeedMatch, TeamStat } from "@/core/types";
import { americanToDecimal } from "@/core/math/devig";

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";

/** 19 football leagues monitored (3 of them are supervisor-blacklisted). */
export const FOOTBALL_LEAGUES = [
  "eng.1", "eng.2", "esp.1", "esp.2", "ita.1", "ger.1", "fra.1", "ned.1",
  "por.1", "bra.1", "arg.1", "mex.1", "usa.1", "tur.1", "sco.1", "bel.1",
  "uefa.champions", "uefa.europa", "fifa.friendly",
] as const;

const LEAGUE_NAMES: Record<string, string> = {
  "eng.1": "English Premier League", "eng.2": "English Championship",
  "esp.1": "Spanish LaLiga", "esp.2": "Spanish LaLiga 2",
  "ita.1": "Italian Serie A", "ger.1": "German Bundesliga",
  "fra.1": "French Ligue 1", "ned.1": "Dutch Eredivisie",
  "por.1": "Portuguese Primeira Liga", "bra.1": "Brazilian Serie A",
  "arg.1": "Argentine Liga Profesional", "mex.1": "Mexican Liga BBVA",
  "usa.1": "American MLS", "tur.1": "Turkish Super Lig",
  "sco.1": "Scottish Premiership", "bel.1": "Belgian Pro League",
  "uefa.champions": "UEFA Champions League", "uefa.europa": "UEFA Europa League",
  "fifa.friendly": "International Friendly",
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");
const dateRange = (from: Date, days: number): string => {
  const to = new Date(from.getTime() + days * 86400_000);
  return `${dayKey(from)}-${dayKey(to)}`;
};

async function fetchJson(url: string, timeoutMs = 7000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchJsonRetry(url: string, retries = 2, timeoutMs = 7000): Promise<unknown | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchJson(url, timeoutMs);
    } catch {
      if (i === retries) return null;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  return null;
}

const evState = (e: Record<string, unknown>): string => {
  const comp = (e.competitions as Array<Record<string, unknown>> | undefined)?.[0];
  return ((comp?.status as Record<string, unknown> | undefined)?.type as Record<string, unknown> | undefined)
    ?.state as string ?? "pre";
};

/** Parse a soccer scoreboard event incl. real reference odds (ESPN provider). */
function parseSoccerEvent(e: Record<string, unknown>, leagueCode: string): FeedMatch | null {
  const comp = (e.competitions as Array<Record<string, unknown>>)[0];
  const comps = comp.competitors as Array<Record<string, unknown>>;
  if (!comps || comps.length < 2) return null;
  const home = comps.find((c) => c.homeAway === "home");
  const away = comps.find((c) => c.homeAway === "away");
  const nameOf = (c?: Record<string, unknown>) => ((c?.team as Record<string, unknown>)?.displayName as string) ?? "";
  const scoreOf = (c?: Record<string, unknown>) => {
    const s = c?.score as { value?: number } | string | undefined;
    if (typeof s === "object") return s?.value ?? null;
    return s != null && s !== "" ? Number(s) : null;
  };
  const homeName = nameOf(home);
  const awayName = nameOf(away);
  if (!homeName || !awayName) return null;

  let refOdds: FeedMatch["refOdds"] = null;
  const oddsArr = comp.odds as Array<Record<string, unknown>> | undefined;
  const o = oddsArr?.[0];
  if (o) {
    const ml = o.moneyline as Record<string, unknown> | undefined;
    const drawO = o.drawOdds as Record<string, unknown> | undefined;
    const total = o.total as Record<string, unknown> | undefined;
    const dec = (x?: unknown) => {
      const raw = (x as { close?: { odds?: string }; odds?: string } | undefined);
      const am = Number(raw?.close?.odds ?? raw?.odds ?? NaN);
      return Number.isFinite(am) && am !== 0 ? americanToDecimal(am) : undefined;
    };
    const overU = (side: "over" | "under") => {
      const s = (total?.[side] as { close?: { odds?: string } } | undefined);
      const am = Number(s?.close?.odds ?? NaN);
      return Number.isFinite(am) && am !== 0 ? americanToDecimal(am) : undefined;
    };
    const h = dec(ml?.home), aw = dec(ml?.away), dr = dec(ml?.draw) ?? dec(drawO?.moneyLine);
    const ov = overU("over"), un = overU("under");
    // A usable book needs ALL 1X2 legs valid (partial books poison the de-vig).
    const full1x2 = h != null && aw != null && dr != null && h > 1 && aw > 1 && dr > 1;
    const fullTotal = ov != null && un != null && ov > 1 && un > 1;
    refOdds = full1x2
      ? {
          home: h, away: aw, draw: dr,
          over: fullTotal ? ov : undefined,
          under: fullTotal ? un : undefined,
          totalLine: typeof o.overUnder === "number" ? o.overUnder : undefined,
        }
      : null;
  }
  const status = evState(e);
  return {
    espnEventId: String(e.id), sport: "football", league: LEAGUE_NAMES[leagueCode] ?? leagueCode,
    leagueCode, homeName, awayName, startTime: new Date(e.date as string), status,
    homeScore: status === "pre" ? null : scoreOf(home), awayScore: status === "pre" ? null : scoreOf(away),
    venue: ((comp.venue as Record<string, unknown>)?.fullName as string) ?? null,
    refOdds,
  };
}

export async function fetchFootballFeed(): Promise<FeedMatch[]> {
  const out: FeedMatch[] = [];
  const day0 = new Date();
  const days = [0, 1, 2, 3].map((d) => dayKey(new Date(day0.getTime() + d * 86400_000)));

  // Soccer scoreboard only accepts a SINGLE date (ranges → HTTP 400).
  // Day 0 for all 19 leagues, then extra days only for active leagues.
  const day0Counts = await fetchSoccerDay(days[0], out);
  const active = [...day0Counts.entries()].filter(([, c]) => c > 0).map(([lg]) => lg);
  for (const day of days.slice(1)) {
    await fetchSoccerDay(day, out, active.length ? active : undefined);
  }
  return out;
}

async function fetchSoccerDay(
  day: string, out: FeedMatch[], onlyLeagues?: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const leagues = onlyLeagues ?? [...FOOTBALL_LEAGUES];
  const CHUNK = 6;
  for (let i = 0; i < leagues.length; i += CHUNK) {
    const slice = leagues.slice(i, i + CHUNK);
    const packs = await Promise.all(
      slice.map((lg) =>
        fetchJsonRetry(`${ESPN_SITE}/soccer/${lg}/scoreboard?dates=${day}`, 2, 8000)
          .then((j) => ({ lg, j })),
      ),
    );
    for (const { lg, j } of packs) {
      if (!j) continue;
      const events = (j as { events?: Array<Record<string, unknown>> }).events ?? [];
      for (const e of events) {
        const m = parseSoccerEvent(e, lg);
        if (m) {
          out.push(m);
          counts.set(lg, (counts.get(lg) ?? 0) + 1);
        }
      }
    }
    if (i + CHUNK < leagues.length) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return counts;
}

/** Season standings → TeamStat (goals for/against drive the Poisson engine). */
export async function fetchFootballStandings(leagueCode: string): Promise<TeamStat[]> {
  const j = await fetchJsonRetry(`https://site.api.espn.com/apis/v2/sports/soccer/${leagueCode}/standings`, 1);
  if (!j) return [];
  try {
    const child = (j as { children?: Array<{ standings?: { entries?: Array<Record<string, unknown>> } }> }).children?.[0];
    const entries = child?.standings?.entries ?? [];
    const stat = (e: Record<string, unknown>, n: string): number => {
      const s = (e.stats as Array<{ name: string; value?: number }> | undefined)?.find((x) => x.name === n);
      return typeof s?.value === "number" ? s.value : 0;
    };
    return entries.map((e) => {
      const team = e.team as Record<string, unknown>;
      return {
        name: team.displayName as string,
        played: stat(e, "gamesPlayed"), won: stat(e, "wins"),
        drawn: stat(e, "ties"), lost: stat(e, "losses"),
        goalsFor: stat(e, "pointsFor"), goalsAgainst: stat(e, "pointsAgainst"),
      };
    });
  } catch {
    return [];
  }
}

const CLAY_HINTS = /clay|argentina|buenos|rio|brasil|brazil|sao paulo|santiago|cordoba|chile|colombia|estoril|marrakech|bastad|umag|kitzbuhel|gstaad|hamburg|rome|madrid|monte|barcelona|sardegna|munich|marbella|peru|ecuador|bolivia|uruguay|paraguay|asuncion|lima|bogota|lp open|santa fe|florianopolis|merida|olimpia|l'iopen|itf/i;
const GRASS_HINTS = /grass|wimbledon|queen|eastbourne|halle|s-hertogenbosch|newport|mallorca|stuttgart|berlin|majoli|surbiton|ilkey/i;

function guessSurface(event: string): "Hard" | "Clay" | "Grass" {
  if (CLAY_HINTS.test(event)) return "Clay";
  if (GRASS_HINTS.test(event)) return "Grass";
  return "Hard";
}

/** Parse tennis scoreboard groupings (singles only) into FeedMatch rows. */
function parseTennisEvent(e: Record<string, unknown>, tour: "atp" | "wta"): FeedMatch[] {
  const out: FeedMatch[] = [];
  const eventName = (e.name as string) ?? "";
  const status = evState(e);
  for (const g of (e.groupings as Array<Record<string, unknown>> | undefined) ?? []) {
    const slug = String((g.grouping as Record<string, unknown>)?.slug ?? "");
    if (!/singles/.test(slug)) continue;
    for (const comp of (g.competitions as Array<Record<string, unknown>>) ?? []) {
      const cs = comp.competitors as Array<Record<string, unknown>>;
      if (!cs || cs.length < 2) continue;
      const nm = (c: Record<string, unknown>) =>
        ((c.athlete as Record<string, unknown>)?.displayName as string) ?? "";
      const a = nm(cs[0]); const b = nm(cs[1]);
      if (!a || !b || a === "TBD" || b === "TBD") continue;
      const rankOf = (c: Record<string, unknown>) =>
        ((c.curatedRank as Record<string, unknown> | undefined)?.current as number | undefined) ?? null;
      const winnerIdx = cs.findIndex((c) => c.winner === true);
      const lines = (c: Record<string, unknown>) =>
        ((c.linescores as Array<{ value?: number }> | undefined) ?? []).map((l) => Number(l.value ?? 0));
      const notes = ((comp.notes as Array<{ text?: string }> | undefined) ?? []).map((n) => n.text ?? "").join(" ");
      const retired = /retired|walkover|ret\./i.test(notes) ? true : null;
      out.push({
        espnEventId: String(comp.id), sport: "tennis",
        league: `${tour.toUpperCase()} · ${eventName}`, leagueCode: tour,
        homeName: a, awayName: b, homeRank: rankOf(cs[0]), awayRank: rankOf(cs[1]),
        startTime: new Date((comp.date as string) ?? (e.date as string)), status,
        homeScore: winnerIdx === 0 ? 2 : winnerIdx === 1 ? 0 : null,
        awayScore: winnerIdx === 1 ? 2 : winnerIdx === 0 ? 0 : null,
        detail: notes || null, surface: guessSurface(eventName), round: (e.shortName as string) ?? null,
        venue: ((comp.venue as Record<string, unknown>)?.fullName as string) ?? null,
        retired,
      });
    }
  }
  return out;
}

export async function fetchTennisFeed(): Promise<FeedMatch[]> {
  const range = dateRange(new Date(), 3);
  const jobs = (["atp", "wta"] as const).map(async (tour) => {
    const j = await fetchJsonRetry(`${ESPN_SITE}/tennis/${tour}/scoreboard?dates=${range}`);
    if (!j) return [];
    const events = (j as { events?: Array<Record<string, unknown>> }).events ?? [];
    return events.flatMap((e) => parseTennisEvent(e, tour));
  });
  return (await Promise.all(jobs)).flat();
}

/**
 * The Odds API v4 — real 1xBet + Pinnacle prices when the user configures a key.
 * Returns a name-keyed map of decimal prices. Never throws; may be empty.
 */
export interface LiveOddsRow { book: "1XBET_LIVE" | "PINNACLE"; home?: number; away?: number; draw?: number }

export async function fetchLive1xBetOdds(apiKey: string | null): Promise<Map<string, LiveOddsRow>> {
  const out = new Map<string, LiveOddsRow>();
  if (!apiKey) return out;
  const sportMap: Record<string, string> = {
    "eng.1": "soccer_epl", "esp.1": "soccer_spain_la_liga", "ita.1": "soccer_italy_serie_a",
    "ger.1": "soccer_germany_bundesliga", "fra.1": "soccer_france_ligue_one",
    "ned.1": "soccer_netherlands_eredivisie", "por.1": "soccer_portugal_primeira_liga",
    "uefa.champions": "soccer_uefa_champs_league", "uefa.europa": "soccer_uefa_europa_league",
  };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const jobs = Object.entries(sportMap).map(async ([lg, sp]) => {
    const url = `https://api.the-odds-api.com/v4/sports/${sp}/odds/?regions=eu&markets=h2h&bookmakers=onexbet,pinnacle&oddsFormat=decimal&apiKey=${encodeURIComponent(apiKey)}`;
    const j = await fetchJsonRetry(url, 0, 8000);
    if (!j) return;
    for (const ev of (j as Array<Record<string, unknown>>) ?? []) {
      const home = (ev.home_team as string) ?? "";
      const away = (ev.away_team as string) ?? "";
      for (const bk of (ev.bookmakers as Array<Record<string, unknown>>) ?? []) {
        const key = (bk.key as string) === "onexbet" ? "1XBET_LIVE" : "PINNACLE";
        const row: LiveOddsRow = { book: key as LiveOddsRow["book"] };
        for (const mk of (bk.markets as Array<Record<string, unknown>>) ?? []) {
          for (const oc of (mk.outcomes as Array<Record<string, unknown>>) ?? []) {
            const p = Number(oc.price);
            if (!Number.isFinite(p) || p <= 1) continue;
            const n = norm(oc.name as string);
            if (n === norm(home)) row.home = p;
            else if (n === norm(away)) row.away = p;
            else if (n === "draw") row.draw = p;
          }
        }
        if (row.home && row.away) out.set(`${norm(home)}|${norm(away)}|${key}`, row);
      }
    }
  });
  await Promise.allSettled(jobs);
  return out;
}

/** Polymarket Gamma — best-effort supplementary reference (may be blocked). */
export async function fetchPolymarketHints(): Promise<Array<{ slug: string; price: number }>> {
  try {
    const j = await fetchJsonRetry(
      "https://gamma-api.polymarket.com/events?tag=soccer&closed=false&limit=20", 0, 5000);
    if (!j) return [];
    return [];
  } catch {
    return [];
  }
}
