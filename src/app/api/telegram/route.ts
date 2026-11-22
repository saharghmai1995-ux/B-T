import { NextResponse } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import { renderPosterSvg, type PosterKind, type PosterSpec } from "@/core/telegram/poster-renderer";
import { formatOfficialBookmakerMarket, cleanSelectionLabel } from "@/core/bookmakers/market-aliases";
import { resolveBroadcastTarget, type BroadcastChannel } from "@/core/pipeline/settings";
import { sendPhotoTo } from "@/core/telegram/bot-client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface TelegramBody {
  kind: PosterKind;
  signalId?: string;
  spec?: Partial<PosterSpec>;
  send?: boolean; // actually sendPhoto when bot token configured
  channel?: BroadcastChannel; // "PUBLIC" | "VIP" | "DEFAULT" broadcast lane
  caption?: string; // v2.7 — bilingual caption for the Telegram message
}

/** POST /api/telegram — render poster (SVG→PNG) + optional sendPhoto to a lane. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TelegramBody;
    const lane: BroadcastChannel =
      body.channel === "PUBLIC" || body.channel === "VIP" || body.channel === "DEFAULT"
        ? body.channel
        : "DEFAULT";
    // v2.7 STRICT ROUTING — match/settlement cards may ONLY target the VIP
    // lane. Any attempt to push a SIGNAL/WIN/LOSS card to PUBLIC/DEFAULT is
    // rejected honestly with a clear error.
    const cardKind = body.kind === "SIGNAL" || body.kind === "WIN" || body.kind === "LOSS";
    if (cardKind && body.send && lane !== "VIP") {
      return NextResponse.json(
        { ok: false, error: "کارت سیگنال/تسویه فقط به کانال VIP ارسال می‌شود (قانون مسیریابی v2.7)" },
        { status: 400 },
      );
    }
    const built = await buildSpec(body);
    const spec = built.spec;
    const svg = renderPosterSvg(spec);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const base64 = png.toString("base64");
    let sent = false;
    let transport = "preview";
    let sendError: string | undefined;

    if (built.logosMissing) {
      // v2.7 hard rule — honest refusal: no card leaves without club artwork.
      sent = false;
      transport = "logos_missing";
      sendError = "کارت بدون لوگو/پرچم باشگاه ارسال نمی‌شود — artwork واقعی در فید نیست";
    } else if (body.send) {
      const chatId = await resolveBroadcastTarget(lane);
      if (chatId) {
        const result = await sendPhotoTo(chatId, new Uint8Array(png), body.caption);
        sent = result.ok;
        transport = result.ok ? "sendPhoto" : "sendPhoto_failed";
        sendError = result.error;
      } else {
        transport = lane === "DEFAULT" ? "missing_credentials" : `channel_${lane.toLowerCase()}_unset`;
      }
    }

    await db.posterLog.create({
      data: {
        kind: spec.kind, signalId: body.signalId ?? null,
        title: spec.kind === "NEWS" ? (spec.headline ?? "News poster").slice(0, 180) : spec.matchInfo,
        sent, transport,
      },
    });

    return NextResponse.json({ ok: true, poster: { svg, pngBase64: base64, spec }, sent, transport, error: sendError, lane });
  } catch (err) {
    console.error("telegram render failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "render failed" },
      { status: 500 },
    );
  }
}

/** Build the poster spec from a stored signal (or inline overrides). */
async function buildSpec(body: TelegramBody): Promise<{ spec: PosterSpec; logosMissing: boolean }> {
  const base: PosterSpec = {
    kind: body.kind ?? "SIGNAL",
    matchInfo: "Fixture pending — live feed sync",
    marketLabel: "Market pending",
    selection: "—",
    price: 0,
  };
  if (body.spec) Object.assign(base, body.spec);
  if (body.signalId) {
    const s = await db.signal.findUnique({
      where: { id: body.signalId },
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
    if (s) {
      // v2.7.1 §1 — official bookmaker market name + REAL team name on every
      // poster (raw `◆` / HOME/AAY formats are retired everywhere).
      const clean = formatOfficialBookmakerMarket(s.marketKey, s.selection, s.match.homeName, s.match.awayName);
      base.matchInfo = `${s.match.homeName} vs ${s.match.awayName}`;
      base.homeName = s.match.homeName;
      base.awayName = s.match.awayName;
      base.competition = s.match.league;
      base.sport = s.match.sport as "football" | "tennis";
      base.marketLabel = clean.posterLabel;
      base.selection = cleanSelectionLabel(s.marketKey, s.selection, s.match.homeName, s.match.awayName);
      base.price = s.price;
      base.evPct = s.evPct;
      base.prob = s.modelProb * 100;
      base.stake = s.stake;
      base.netProfit = s.netProfit ?? undefined;
      base.hash = s.shaHash;
      base.kickoffIso = s.match.startTime.toISOString();
      base.venue = s.match.venue ?? (s.match.surface ? `${s.match.surface} Court` : undefined);
      // v2.7 hard rule — a match card NEVER leaves without both club logos/
      // flags. Missing artwork blocks the send honestly (no initials fallback
      // ever reaches a channel).
      if (body.send && (!s.match.homeLogo || !s.match.awayLogo)) {
        return { spec: base, logosMissing: true };
      }
    }
  }
  return { spec: base, logosMissing: false };
}
