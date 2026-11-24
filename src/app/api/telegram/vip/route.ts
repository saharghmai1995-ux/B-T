/**
 * /api/telegram/vip (v3.4) — the full management surface of @Aineobet_bot
 * for the private "NeoBet VIP 👑" channel.
 *
 * GET  → live status (bot, channel, bot admin rights, member count, admins,
 *        auto-approve, updater heartbeat) + dedicated links + join requests
 *        + the honest event stream.
 * POST → one real action per call:
 *        create_link | revoke_link | approve_request | decline_request |
 *        kick_member | toggle_auto_approve | poll_now | set_channel
 */

import { NextResponse } from "next/server";
import { setSetting, SETTING_KEYS } from "@/core/pipeline/settings";
import {
  getVipStatus,
  createDedicatedLink,
  revokeLink,
  listLinks,
  listJoinRequests,
  approveJoinRequest,
  declineJoinRequest,
  kickMember,
  setAutoApprove,
  recentEvents,
  logVipEvent,
} from "@/core/telegram/vip-service";
import { updaterStats, sweepOnce } from "@/core/telegram/updater";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function normalizeChannelId(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^-?\d{5,}$/.test(v)) return v;
  if (/^@[A-Za-z0-9_]{3,64}$/.test(v)) return v;
  return null;
}

/** GET /api/telegram/vip — full VIP gate state. */
export async function GET() {
  try {
    const [status, links, requests, events] = await Promise.all([
      getVipStatus(),
      listLinks(),
      listJoinRequests(),
      recentEvents(),
    ]);
    return NextResponse.json({
      ok: true,
      status,
      links,
      requests,
      events,
      updater: updaterStats(),
    });
  } catch (err) {
    console.error("telegram vip status failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "status failed" },
      { status: 500 },
    );
  }
}

interface VipBody {
  action:
    | "create_link"
    | "revoke_link"
    | "approve_request"
    | "decline_request"
    | "kick_member"
    | "toggle_auto_approve"
    | "poll_now"
    | "set_channel";
  label?: string;
  memberLimit?: number;
  expiresInHours?: number;
  createsJoinRequest?: boolean;
  id?: string;
  userId?: number;
  enabled?: boolean;
  channelId?: string;
}

/** POST /api/telegram/vip — execute one real management action. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as VipBody;

    switch (body.action) {
      case "create_link": {
        const r = await createDedicatedLink({
          label: body.label ?? "",
          memberLimit: body.memberLimit,
          expiresInHours: body.expiresInHours,
          createsJoinRequest: body.createsJoinRequest,
        });
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
        return NextResponse.json({ ok: true, link: r.link });
      }

      case "revoke_link": {
        if (!body.id) return NextResponse.json({ ok: false, error: "id الزامی است" }, { status: 400 });
        const r = await revokeLink(body.id);
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
        return NextResponse.json({ ok: true });
      }

      case "approve_request": {
        if (!body.id) return NextResponse.json({ ok: false, error: "id الزامی است" }, { status: 400 });
        const r = await approveJoinRequest(body.id, "admin");
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
        return NextResponse.json({ ok: true });
      }

      case "decline_request": {
        if (!body.id) return NextResponse.json({ ok: false, error: "id الزامی است" }, { status: 400 });
        const r = await declineJoinRequest(body.id);
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
        return NextResponse.json({ ok: true });
      }

      case "kick_member": {
        if (!Number.isFinite(body.userId)) {
          return NextResponse.json({ ok: false, error: "userId الزامی است" }, { status: 400 });
        }
        const r = await kickMember(Number(body.userId));
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
        return NextResponse.json({ ok: true });
      }

      case "toggle_auto_approve": {
        const enabled = body.enabled === true;
        await setAutoApprove(enabled);
        const chatId = await import("@/core/telegram/vip-service").then((m) => m.getVipChatId());
        if (chatId) {
          await logVipEvent(chatId, "ADMIN_ACTION", {
            detail: `auto-approve ${enabled ? "ENABLED" : "DISABLED"} via studio`,
          });
        }
        return NextResponse.json({ ok: true, enabled });
      }

      case "poll_now": {
        const r = await sweepOnce();
        return NextResponse.json({ ok: r.ok, processed: r.processed, error: r.error, updater: updaterStats() });
      }

      case "set_channel": {
        const id = normalizeChannelId(body.channelId ?? "");
        if (!id) {
          return NextResponse.json(
            { ok: false, error: "شناسه کانال نامعتبر است — @username یا -100..." },
            { status: 400 },
          );
        }
        await setSetting(SETTING_KEYS.telegramVipChannelId, id);
        const status = await getVipStatus();
        return NextResponse.json({ ok: true, status });
      }

      default:
        return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("telegram vip action failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "action failed" },
      { status: 500 },
    );
  }
}
