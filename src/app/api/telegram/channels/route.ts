import { NextResponse } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import {
  SETTING_KEYS,
  getChannelId,
  getDefaultChatId,
  setSetting,
} from "@/core/pipeline/settings";
import {
  verifyBot,
  inspectChat,
  sendPhotoTo,
  sendMessageTo,
} from "@/core/telegram/bot-client";
import { renderPosterSvg, type PosterSpec } from "@/core/telegram/poster-renderer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Lane = "PUBLIC" | "VIP" | "DEFAULT";

interface LaneStatus {
  configured: boolean;
  reachable: boolean;
  chatId: string;
  title?: string;
  type?: string;
  username?: string;
  error?: string;
}

/** GET /api/telegram/channels — live connection status for the bot + both lanes. */
export async function GET() {
  try {
    const [bot, pubId, vipId, defId] = await Promise.all([
      verifyBot(),
      getChannelId("PUBLIC"),
      getChannelId("VIP"),
      getDefaultChatId(),
    ]);

    const inspect = async (chatId: string | null): Promise<LaneStatus> => {
      if (!chatId) return { configured: false, reachable: false, chatId: "", error: "not_configured" };
      const c = await inspectChat(chatId);
      return {
        configured: true,
        reachable: c.reachable,
        chatId: c.chatId,
        title: c.title,
        type: c.type,
        username: c.username,
        error: c.error,
      };
    };

    const [publicLane, vipLane, defaultLane] = await Promise.all([
      inspect(pubId),
      inspect(vipId),
      inspect(defId),
    ]);

    // Recent delivery attempts — the honest outbox view.
    const recent = await db.posterLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, kind: true, title: true, sent: true, transport: true, createdAt: true },
    });

    return NextResponse.json({
      ok: true,
      bot,
      lanes: { PUBLIC: publicLane, VIP: vipLane, DEFAULT: defaultLane },
      recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    });
  } catch (err) {
    console.error("telegram channels status failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "status failed" },
      { status: 500 },
    );
  }
}

interface ChannelsBody {
  action: "save" | "test" | "verify";
  publicChannelId?: string;
  vipChannelId?: string;
  channel?: Lane;
}

/** Validate a channel handle: @username or numeric chat id (optionally -100...). */
function normalizeChannelId(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^-?\d{5,}$/.test(v)) return v;
  if (/^@[A-Za-z0-9_]{3,64}$/.test(v)) return v;
  return null;
}

/** POST /api/telegram/channels — save lane ids, test-send a card, or re-verify. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChannelsBody;

    if (body.action === "save") {
      const saved: string[] = [];
      const pub = normalizeChannelId(body.publicChannelId ?? "");
      const vip = normalizeChannelId(body.vipChannelId ?? "");
      if (body.publicChannelId !== undefined) {
        if (body.publicChannelId.trim() && !pub) {
          return NextResponse.json(
            { ok: false, error: "شناسه کانال عمومی نامعتبر است — @username یا شناسه عددی" },
            { status: 400 },
          );
        }
        if (pub) await setSetting(SETTING_KEYS.telegramPublicChannelId, pub);
        saved.push("PUBLIC");
      }
      if (body.vipChannelId !== undefined) {
        if (body.vipChannelId.trim() && !vip) {
          return NextResponse.json(
            { ok: false, error: "شناسه کانال VIP نامعتبر است — @username یا شناسه عددی" },
            { status: 400 },
          );
        }
        if (vip) await setSetting(SETTING_KEYS.telegramVipChannelId, vip);
        saved.push("VIP");
      }
      return NextResponse.json({ ok: true, saved });
    }

    if (body.action === "verify") {
      const bot = await verifyBot();
      return NextResponse.json({ ok: true, bot });
    }

    if (body.action === "test") {
      const lane: Lane = body.channel === "VIP" || body.channel === "PUBLIC" ? body.channel : "DEFAULT";
      const target =
        lane === "DEFAULT"
          ? await getDefaultChatId()
          : await getChannelId(lane);
      if (!target) {
        return NextResponse.json(
          { ok: false, error: `کانال ${lane} تنظیم نشده است` },
          { status: 400 },
        );
      }
      // End-to-end card pipeline test: render a real poster PNG and push it.
      const spec: PosterSpec = {
        kind: "SIGNAL",
        matchInfo: "CONNECTION TEST CARD",
        competition: "NeoBet Quant Pro — Broadcast Pipeline",
        marketLabel: "Pipeline Diagnostics",
        selection: `${lane} lane is live`,
        price: 2.0,
        evPct: 4.0,
        prob: 52,
        stake: 10,
        kickoffIso: new Date().toISOString(),
        venue: "Telegram Bot API",
      };
      const svg = renderPosterSvg(spec);
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      const photo = await sendPhotoTo(target, new Uint8Array(png));
      if (photo.ok) {
        await db.posterLog.create({
          data: { kind: "SIGNAL", title: `Connection test — ${lane}`, sent: true, transport: "sendPhoto" },
        });
        return NextResponse.json({ ok: true, sent: true, transport: "sendPhoto", lane, target });
      }
      // Photo failed — try a plain text fallback so the admin sees the true cause.
      const text = await sendMessageTo(
        target,
        `NeoBet Quant Pro — connection test (${lane} lane).\nPhoto pipeline error: ${photo.error ?? "unknown"}`,
      );
      await db.posterLog.create({
        data: {
          kind: "SIGNAL", title: `Connection test — ${lane}`,
          sent: text.ok, transport: text.ok ? "sendMessage" : `failed:${photo.error ?? "unknown"}`,
        },
      });
      return NextResponse.json({
        ok: true, sent: text.ok, transport: text.ok ? "sendMessage" : "failed",
        error: text.ok ? undefined : (text.error ?? photo.error), lane, target,
      });
    }

    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (err) {
    console.error("telegram channels action failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "action failed" },
      { status: 500 },
    );
  }
}
