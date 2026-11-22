/**
 * Broadcast Schedule Service — Telegram studio schedule manager.
 * Honest status model: a slot is "sent" ONLY when sentAt is stamped by a
 * real confirmed send action; anything else stays "pending" — including
 * slots whose wall-clock time has already passed (⏳ vs ✅ is never faked).
 */

import { db } from "@/lib/db";

export interface ScheduleSlot {
  id: string;
  slotTitle: string;
  time: string; // "HH:mm" Tehran local time
  channel: "PUBLIC" | "VIP";
  kind: "RADAR" | "SIGNAL" | "EDUCATION" | "NEWS" | "REPORT";
  enabled: boolean;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * v2.7 STRICT ROUTING (patch §6-ج):
 *   VIP lane    → match signal cards + settlement result cards ONLY.
 *   PUBLIC lane → quant education, bilingual ESPN news, transparency
 *                 reports, radar digests and system intros ONLY.
 * A slot's stored channel NEVER overrides the kind rule — the dispatcher
 * resolves the lane from the kind itself.
 */
export function laneForKind(kind: ScheduleSlot["kind"]): "PUBLIC" | "VIP" {
  return kind === "SIGNAL" ? "VIP" : "PUBLIC";
}

const DEFAULT_SLOTS: Array<Pick<ScheduleSlot, "slotTitle" | "time" | "channel" | "kind">> = [
  { slotTitle: "رادار صبح — مرور شبانه بازار", time: "11:00", channel: "PUBLIC", kind: "RADAR" },
  { slotTitle: "کارت سیگنال تنیس ATP/WTA (VIP)", time: "14:00", channel: "VIP", kind: "SIGNAL" },
  { slotTitle: "پست آموزشی کوانت", time: "16:00", channel: "PUBLIC", kind: "EDUCATION" },
  { slotTitle: "کارت سیگنال فوتبال اصلی (VIP)", time: "19:00", channel: "VIP", kind: "SIGNAL" },
  { slotTitle: "خبر فوری دوزبانه ESPN", time: "21:00", channel: "PUBLIC", kind: "NEWS" },
  { slotTitle: "گزارش شفافیت کارنامه روزانه", time: "23:30", channel: "PUBLIC", kind: "REPORT" },
];

function toSlot(r: {
  id: string; slotTitle: string; time: string; channel: string; kind: string;
  enabled: boolean; sentAt: Date | null; createdAt: Date; updatedAt: Date;
}): ScheduleSlot {
  return {
    id: r.id, slotTitle: r.slotTitle, time: r.time,
    channel: (r.channel === "VIP" ? "VIP" : "PUBLIC"),
    kind: (["RADAR", "SIGNAL", "EDUCATION", "NEWS", "REPORT"].includes(r.kind) ? r.kind : "SIGNAL") as ScheduleSlot["kind"],
    enabled: r.enabled,
    sentAt: r.sentAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listSchedule(): Promise<ScheduleSlot[]> {
  const count = await db.broadcastSchedule.count();
  if (count === 0) {
    await db.broadcastSchedule.createMany({
      data: DEFAULT_SLOTS.map((s) => ({ ...s, enabled: true })),
    });
  }
  const rows = await db.broadcastSchedule.findMany({ orderBy: { time: "asc" } });
  return rows.map(toSlot);
}

export async function createSlot(input: {
  slotTitle: string; time: string; channel?: string; kind?: string;
}): Promise<ScheduleSlot> {
  const kind = (["RADAR", "SIGNAL", "EDUCATION", "NEWS", "REPORT"].includes(input.kind ?? "") ? input.kind! : "SIGNAL") as ScheduleSlot["kind"];
  const row = await db.broadcastSchedule.create({
    data: {
      slotTitle: input.slotTitle.slice(0, 120),
      time: normalizeTime(input.time),
      // v2.7 strict routing — the channel ALWAYS follows the kind rule.
      channel: laneForKind(kind),
      kind,
      enabled: true,
    },
  });
  return toSlot(row);
}

export async function updateSlot(id: string, patch: {
  slotTitle?: string; time?: string; channel?: string; kind?: string; enabled?: boolean; markSent?: boolean;
}): Promise<ScheduleSlot | null> {
  const data: Record<string, unknown> = {};
  if (typeof patch.slotTitle === "string" && patch.slotTitle.trim()) data.slotTitle = patch.slotTitle.trim().slice(0, 120);
  if (typeof patch.time === "string") data.time = normalizeTime(patch.time);
  // v2.7 strict routing — kind changes re-derive the lane; direct channel
  // patches that violate the kind rule are normalized instead of stored.
  if (typeof patch.kind === "string" && ["RADAR", "SIGNAL", "EDUCATION", "NEWS", "REPORT"].includes(patch.kind)) {
    data.kind = patch.kind;
    data.channel = laneForKind(patch.kind as ScheduleSlot["kind"]);
  } else if (typeof patch.channel === "string") {
    const row = await db.broadcastSchedule.findUnique({ where: { id }, select: { kind: true } });
    if (row) data.channel = laneForKind(row.kind as ScheduleSlot["kind"]);
  }
  if (typeof patch.enabled === "boolean") data.enabled = patch.enabled;
  // A send is confirmed ONLY through the explicit markSent action (or a real
  // sendPhoto result wired by the caller). Future slots can never be "sent".
  if (patch.markSent === true) data.sentAt = new Date();
  if (patch.markSent === false) data.sentAt = null;
  if (Object.keys(data).length === 0) return null;
  const row = await db.broadcastSchedule.update({ where: { id }, data });
  return toSlot(row);
}

export async function deleteSlot(id: string): Promise<boolean> {
  const res = await db.broadcastSchedule.deleteMany({ where: { id } });
  return res.count > 0;
}

/** Send-history log: the most recent confirmed sends + queue size. */
export async function scheduleStats(): Promise<{ total: number; sent: number; pending: number; lastSentAt: string | null }> {
  const rows = await db.broadcastSchedule.findMany();
  const sent = rows.filter((r) => r.sentAt);
  return {
    total: rows.length,
    sent: sent.length,
    pending: rows.length - sent.length,
    lastSentAt: sent.map((r) => r.sentAt!).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null,
  };
}

function normalizeTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) throw new Error("Invalid time format — use HH:mm");
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
