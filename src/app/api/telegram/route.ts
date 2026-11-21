import { NextResponse } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import { renderPosterSvg, type PosterKind, type PosterSpec } from "@/core/telegram/poster-renderer";
import { getSetting, SETTING_KEYS } from "@/core/pipeline/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface TelegramBody {
  kind: PosterKind;
  signalId?: string;
  spec?: Partial<PosterSpec>;
  send?: boolean; // actually sendPhoto when bot token configured
}

/** POST /api/telegram — render poster (SVG→PNG) + optional sendPhoto, no caption. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TelegramBody;
    const spec = await buildSpec(body);
    const svg = renderPosterSvg(spec);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const base64 = png.toString("base64");
    let sent = false;
    let transport = "preview";

    if (body.send) {
      const token = await getSetting(SETTING_KEYS.telegramBotToken);
      const chatId = await getSetting(SETTING_KEYS.telegramChatId);
      if (token && chatId) {
        const form = new FormData();
        form.append("chat_id", chatId);
        const blob = new Blob([new Uint8Array(png)], { type: "image/png" });
        form.append("photo", blob, "poster.png");
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: "POST",
          body: form,
        });
        sent = res.ok;
        transport = res.ok ? "sendPhoto" : "sendPhoto_failed";
      } else {
        transport = "missing_credentials";
      }
    }

    await db.posterLog.create({
      data: {
        kind: spec.kind, signalId: body.signalId ?? null,
        title: spec.matchInfo, sent, transport,
      },
    });

    return NextResponse.json({ ok: true, poster: { svg, pngBase64: base64, spec }, sent, transport });
  } catch (err) {
    console.error("telegram render failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "render failed" },
      { status: 500 },
    );
  }
}

/** Build the poster spec from a stored signal (or inline overrides). */
async function buildSpec(body: TelegramBody): Promise<PosterSpec> {
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
      include: { match: { select: { homeName: true, awayName: true, league: true } } },
    });
    if (s) {
      base.matchInfo = `${s.match.homeName} vs ${s.match.awayName} — ${s.match.league}`;
      base.marketLabel = s.marketLabel;
      base.selection = s.selection;
      base.price = s.price;
      base.evPct = s.evPct;
      base.prob = s.modelProb * 100;
      base.stake = s.stake;
      base.netProfit = s.netProfit ?? undefined;
      base.hash = s.shaHash;
    }
  }
  return base;
}
