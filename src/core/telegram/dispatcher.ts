/**
 * Broadcast Dispatcher (v2.6) — automated PUBLIC/VIP channel management.
 *
 * A 60-second in-process tick (booted with the Warm Engine) walks the
 * BroadcastSchedule board and fires every due slot to its configured lane:
 *   SLOT SIGNAL     → best OPEN signal rendered as a real 1080x1350 card
 *   SLOT RADAR      → market digest text from today's live feed
 *   SLOT EDUCATION  → rotating quant lesson (deterministic by Tehran date)
 *   SLOT NEWS       → top ESPN headline of the hour
 *   SLOT REPORT     → honest daily ledger report (W/L, units P/L)
 *
 * Honesty rules preserved: sentAt is stamped ONLY on a confirmed Telegram
 * send; failures stay pending and are retried on the next tick within the
 * same day window. Nothing is ever faked.
 */

import sharp from "sharp";
import { db } from "@/lib/db";
import { tehranDayKey } from "@/core/pipeline/ingest-service";
import { listSchedule, updateSlot, laneForKind } from "@/core/telegram/broadcast-service";
import { renderPosterSvg, type PosterSpec } from "@/core/telegram/poster-renderer";
import { getChannelId, getTelegramBotToken } from "@/core/pipeline/settings";
import { sendPhotoTo, sendMessageTo, type SendResult } from "@/core/telegram/bot-client";

const DISPATCH_INTERVAL_MS = 60_000;
const FIRST_TICK_DELAY_MS = 70_000; // after the first warm-engine tick

interface DispatcherState {
  started: boolean;
  running: boolean;
  lastTick: number | null;
  lastResult: string;
  totalSent: number;
}

const globalDispatch = globalThis as unknown as {
  __neobetBroadcastDispatcher?: DispatcherState;
};

const state =
  globalDispatch.__neobetBroadcastDispatcher ??
  (globalDispatch.__neobetBroadcastDispatcher = {
    started: false, running: false, lastTick: null, lastResult: "idle", totalSent: 0,
  });

/** Public snapshot for the health endpoint / studio. */
export function dispatcherStats(): DispatcherState & { lastTickIso: string | null } {
  return {
    ...state,
    lastTickIso: state.lastTick ? new Date(state.lastTick).toISOString() : null,
  };
}

/* ---------------- Tehran clock helpers ---------------- */

function tehranClock(d: Date): { hhmm: string; dayKey: string; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  const hhmm = `${hh}:${mm}`;
  const minuteOfDay = Number(hh) * 60 + Number(mm);
  return { hhmm, dayKey: tehranDayKey(d), minuteOfDay };
}

function slotMinuteOfDay(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

/* ---------------- Content builders (real data only) ---------------- */

async function buildSignalCard(): Promise<{ png: Uint8Array; caption: string; title: string } | null> {
  const s = await db.signal.findFirst({
    where: { status: "OPEN" },
    orderBy: { evPct: "desc" },
    include: {
      match: {
        select: {
          homeName: true, awayName: true, league: true, venue: true,
          startTime: true, surface: true, sport: true,
          homeLogo: true, awayLogo: true,
        },
      },
    },
  });
  if (!s) return null;
  // v2.7 hard rule — a match card never broadcasts without both club logos.
  if (!s.match.homeLogo || !s.match.awayLogo) return null;
  const kickoff = s.match.startTime;
  const hoursAhead = (kickoff.getTime() - Date.now()) / 3_600_000;
  if (hoursAhead < 0.5 || hoursAhead > 96) return null; // stale or too far — skip honestly

  const spec: PosterSpec = {
    kind: "SIGNAL",
    matchInfo: `${s.match.homeName} vs ${s.match.awayName}`,
    homeName: s.match.homeName,
    awayName: s.match.awayName,
    competition: s.match.league,
    sport: s.match.sport as "football" | "tennis",
    marketLabel: s.marketLabel,
    selection: s.selection,
    price: s.price,
    evPct: s.evPct,
    prob: s.modelProb * 100,
    stake: s.stake,
    hash: s.shaHash,
    kickoffIso: kickoff.toISOString(),
    venue: s.match.venue ?? (s.match.surface ? `${s.match.surface} Court` : undefined),
  };
  const svg = renderPosterSvg(spec);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const caption =
    `⚡ <b>${s.selection}</b> @ ${s.price.toFixed(2)}\n` +
    `${s.marketLabel} — ${s.match.league}\n` +
    `EV +${s.evPct.toFixed(1)}% | Prob ${(s.modelProb * 100).toFixed(1)}% | Stake ${s.stake.toFixed(0)}u\n` +
    `🔒 SHA-256 verified — NeoBet Quant Pro`;
  return { png: new Uint8Array(png), caption, title: spec.matchInfo };
}

async function buildRadarText(): Promise<string | null> {
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 3_600_000);
  const [preTotal, topSignals] = await Promise.all([
    db.match.count({ where: { status: "pre", startTime: { gte: now, lte: in48h } } }),
    db.signal.findMany({
      where: { status: "OPEN" },
      orderBy: { evPct: "desc" },
      take: 3,
      include: { match: { select: { homeName: true, awayName: true, league: true, startTime: true } } },
    }),
  ]);
  if (preTotal === 0 && topSignals.length === 0) return null;
  const lines = topSignals.map((s, i) =>
    `${i + 1}. ${s.selection} @ ${s.price.toFixed(2)} — EV +${s.evPct.toFixed(1)}% (${s.match.homeName} vs ${s.match.awayName})`,
  );
  return (
    `🔎 <b>MORNING RADAR — 48h Market Scan</b>\n\n` +
    `📡 Fixtures priced in window: <b>${preTotal}</b>\n` +
    `🎯 Top model edges right now:\n${lines.join("\n") || "— waiting for qualified edges —"}\n\n` +
    `Data: ESPN + The Odds API v4 — NeoBet Quant Pro`
  );
}

const EDU_LESSONS: Array<{ tag: string; en: string }> = [
  { tag: "KELLY", en: "Quarter-Kelly stakes 25% of the full Kelly fraction — same edge, one quarter of the variance. Long-run growth survives bad clusters." },
  { tag: "SHIN", en: "Shin probabilities split the book margin across informed and noise money — a fairer baseline than naive normalisation." },
  { tag: "CLV", en: "Closing Line Value is the only scoreboard that matters pre-result: beating the close predicts long-run profit." },
  { tag: "EV", en: "Expected Value = (model prob − market implied prob) × price. A signal needs EV ≥ +4% to pass the production gate." },
  { tag: "VARIANCE", en: "Even a 55% edge loses 45% of the time. Units, not feelings: flat exposure turns variance into a curve you can survive." },
  { tag: "ARB", en: "Arbitrage is a structural mismatch between two books. It expires fast — execution speed is part of the edge." },
];

function buildEducationText(dayKey: string): string {
  const idx = Math.abs(Number(dayKey.split("-").join("")) || 0) % EDU_LESSONS.length;
  const l = EDU_LESSONS[idx];
  return `🎓 <b>QUANT LESSON — ${l.tag}</b>\n\n${l.en}\n\nNeoBet Quant Pro — education desk`;
}

async function buildNewsText(): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/news",
      { signal: ctl.signal, cache: "no-store" },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { articles?: Array<Record<string, unknown>> };
    const a = j.articles?.[0];
    if (!a) return null;
    const link = (a.links as Record<string, Record<string, { href?: string }>> | undefined)?.web?.href ?? "";
    return (
      `📰 <b>SPORTS WIRE</b>\n\n` +
      `${String(a.headline ?? "").slice(0, 200)}\n\n` +
      `${String(a.description ?? "").slice(0, 280)}\n\n` +
      (link ? `🔗 ${link}` : "")
    );
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function buildReportText(dayKey: string): Promise<string | null> {
  const settled = await db.signal.findMany({ where: { dayKey, status: { in: ["WON", "LOST", "VOID"] } } });
  if (settled.length === 0) return null;
  const won = settled.filter((s) => s.status === "WON").length;
  const lost = settled.filter((s) => s.status === "LOST").length;
  const voided = settled.filter((s) => s.status === "VOID").length;
  const units = settled.reduce((acc, s) => acc + (s.netProfit ?? 0), 0);
  return (
    `📊 <b>DAILY REPORT — ${dayKey} (VIP)</b>\n\n` +
    `✅ Won: <b>${won}</b>\n❌ Lost: <b>${lost}</b>\n⚪ Void: <b>${voided}</b>\n\n` +
    `💰 Net P/L: <b>${units >= 0 ? "+" : ""}${units.toFixed(1)}u</b>\n` +
    `🔒 Every result settled from the real final score — full transparency.`
  );
}

/* ---------------- Lane delivery ---------------- */

async function deliver(channel: "PUBLIC" | "VIP", payload: { photo?: Uint8Array; text?: string }): Promise<SendResult> {
  const target = await getChannelId(channel);
  if (!target) {
    return { ok: false, transport: "skipped", error: `channel_${channel.toLowerCase()}_unset` };
  }
  if (payload.photo) return sendPhotoTo(target, payload.photo, payload.text);
  return sendMessageTo(target, payload.text ?? "");
}

/* ---------------- Main tick ---------------- */

async function dispatchDueSlots(): Promise<void> {
  const botConfigured = Boolean(await getTelegramBotToken());
  if (!botConfigured) {
    state.lastResult = "token_missing — configure the bot token to enable auto-broadcast";
    return;
  }
  const now = new Date();
  const { hhmm, dayKey, minuteOfDay: nowMin } = tehranClock(now);
  const slots = (await listSchedule()).filter((s) => s.enabled);

  let fired = 0;
  for (const slot of slots) {
    const slotMin = slotMinuteOfDay(slot.time);
    if (slotMin < 0) continue;
    // Due = slot time reached today AND not already stamped sent today.
    if (slot.sentAt && tehranDayKey(new Date(slot.sentAt)) === dayKey) continue;
    if (slotMin > nowMin) continue;

    // v2.7 STRICT ROUTING — the lane follows the KIND, never the stored channel:
    // signal cards → VIP; education/news/radar/transparency reports → PUBLIC.
    const lane = laneForKind(slot.kind);

    let result: SendResult = { ok: false, transport: "skipped", error: "no_content" };
    try {
      if (slot.kind === "SIGNAL") {
        const card = await buildSignalCard();
        if (card) result = await deliver(lane, { photo: card.png, text: card.caption });
      } else if (slot.kind === "RADAR") {
        const text = await buildRadarText();
        if (text) result = await deliver(lane, { text });
      } else if (slot.kind === "EDUCATION") {
        result = await deliver(lane, { text: buildEducationText(dayKey) });
      } else if (slot.kind === "NEWS") {
        const text = await buildNewsText();
        if (text) result = await deliver(lane, { text });
      } else if (slot.kind === "REPORT") {
        const text = await buildReportText(dayKey);
        if (text) result = await deliver(lane, { text });
      }
    } catch (e) {
      result = { ok: false, transport: "error", error: (e as Error).message };
    }

    if (result.ok) {
      await updateSlot(slot.id, { markSent: true });
      await db.posterLog.create({
        data: {
          kind: slot.kind === "SIGNAL" ? "SIGNAL" : "TEASER",
          title: `[auto:${lane}] ${slot.slotTitle}`.slice(0, 180),
          sent: true, transport: result.transport,
        },
      });
      fired += 1;
      state.totalSent += 1;
    } else if (result.error && result.error !== "no_content") {
      console.warn(`[dispatcher] slot "${slot.slotTitle}" (${lane}) failed:`, result.error);
    }
    // no_content → skipped silently; the slot stays pending for the next day.
  }
  state.lastResult = fired > 0
    ? `${fired} slot(s) sent to channels at ${hhmm} Tehran`
    : `tick ok at ${hhmm} Tehran — nothing due`;
}

async function tick(): Promise<void> {
  if (state.running) return; // mutex
  state.running = true;
  try {
    await db.$queryRaw`SELECT 1`;
    await dispatchDueSlots();
  } catch (e) {
    state.lastResult = `tick failed: ${(e as Error).message}`;
  } finally {
    state.lastTick = Date.now();
    state.running = false;
  }
}

/** Idempotent — booted together with the Warm Engine. */
export function startBroadcastDispatcher(): void {
  if (state.started) return;
  state.started = true;
  console.log("[dispatcher] started — PUBLIC/VIP channels managed every 60s");
  setTimeout(() => {
    void tick();
    const t = setInterval(() => void tick(), DISPATCH_INTERVAL_MS);
    if (typeof t.unref === "function") t.unref();
  }, FIRST_TICK_DELAY_MS);
}
