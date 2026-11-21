import { NextResponse } from "next/server";
import { listSchedule, createSlot, updateSlot, deleteSlot, scheduleStats } from "@/core/telegram/broadcast-service";

export const dynamic = "force-dynamic";

/** GET /api/broadcast — the schedule board (seeds defaults on first run). */
export async function GET() {
  try {
    const [slots, stats] = await Promise.all([listSchedule(), scheduleStats()]);
    return NextResponse.json({ ok: true, slots, stats });
  } catch (err) {
    console.error("broadcast list failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "list failed" },
      { status: 500 },
    );
  }
}

interface BroadcastBody {
  action: "create" | "update" | "delete";
  id?: string;
  slotTitle?: string;
  time?: string;
  channel?: "PUBLIC" | "VIP";
  kind?: string;
  enabled?: boolean;
  markSent?: boolean;
}

/** POST /api/broadcast — create / update / delete slots (honest status only). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BroadcastBody;
    if (body.action === "create") {
      if (!body.slotTitle?.trim() || !body.time?.trim()) {
        return NextResponse.json({ ok: false, error: "slotTitle and time are required" }, { status: 400 });
      }
      const slot = await createSlot({
        slotTitle: body.slotTitle, time: body.time,
        channel: body.channel, kind: body.kind,
      });
      const stats = await scheduleStats();
      return NextResponse.json({ ok: true, slot, stats });
    }
    if (body.action === "update" && body.id) {
      const slot = await updateSlot(body.id, {
        slotTitle: body.slotTitle, time: body.time, channel: body.channel,
        enabled: body.enabled, markSent: body.markSent,
      });
      if (!slot) return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });
      const stats = await scheduleStats();
      return NextResponse.json({ ok: true, slot, stats });
    }
    if (body.action === "delete" && body.id) {
      const removed = await deleteSlot(body.id);
      const stats = await scheduleStats();
      return NextResponse.json({ ok: removed, stats });
    }
    return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  } catch (err) {
    console.error("broadcast write failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "write failed" },
      { status: 400 },
    );
  }
}
