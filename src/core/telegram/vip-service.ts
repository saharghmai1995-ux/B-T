/**
 * VIP Access Manager (v3.4) — full lifecycle management of the private
 * "NeoBet VIP 👑" channel through @Aineobet_bot (verified administrator).
 *
 * Every action below maps 1:1 to a REAL Bot-API call:
 *   • createDedicatedLink  → createChatInviteLink   (single-use / limited / expiring)
 *   • revokeLink           → revokeChatInviteLink
 *   • approveJoinRequest   → approveChatJoinRequest (bot right: can_invite_users)
 *   • declineJoinRequest   → declineChatJoinRequest
 *   • kickMember           → banChatMember + unbanChatMember (right: can_restrict_members)
 * DB rows are the audit trail — Telegram remains the source of truth and
 * every failure surfaces verbatim (honesty rule: nothing is ever assumed).
 */

import { db } from "@/lib/db";
import { SETTING_KEYS, getSetting, setSetting, getChannelId } from "@/core/pipeline/settings";
import { verifyBot, inspectChat } from "@/core/telegram/bot-client";
import {
  createChatInviteLink,
  revokeChatInviteLink,
  approveChatJoinRequest,
  declineChatJoinRequest,
  kickChatMember,
  getChatMember,
  getChatMemberCount,
  getChatAdministrators,
  type ChatMemberInfo,
  type AdminRow,
} from "@/core/telegram/bot-client";

export interface VipLinkRow {
  id: string;
  label: string;
  link: string;
  memberLimit: number | null;
  expireAt: string | null;
  isRevoked: boolean;
  revokedAt: string | null;
  createdAt: string;
}

export interface VipRequestRow {
  id: string;
  userId: number;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  status: string;
  handledAt?: string | null;
  handledBy?: string | null;
  createdAt: string;
}

export interface VipEventRow {
  id: string;
  kind: string;
  userId?: number | null;
  username?: string | null;
  firstName?: string | null;
  detail?: string | null;
  createdAt: string;
}

export interface VipStatus {
  bot: { connected: boolean; username?: string; displayName?: string; botId?: number; error?: string };
  channel: {
    configured: boolean;
    reachable: boolean;
    chatId: string;
    title?: string;
    type?: string;
    inviteLink?: string;
    error?: string;
  };
  rights: { ok: boolean; status?: string; canInviteUsers?: boolean; canRestrictMembers?: boolean; canApproveMembers?: boolean; canPostMessages?: boolean; error?: string };
  memberCount: { ok: boolean; count?: number; error?: string };
  admins: { ok: boolean; rows?: AdminRow[]; error?: string };
  autoApprove: boolean;
}

/** The configured VIP channel chat id (settings-backed). */
export async function getVipChatId(): Promise<string | null> {
  return getChannelId("VIP");
}

/** Log into the honest VIP event stream. */
export async function logVipEvent(
  channelChatId: string,
  kind: string,
  extra?: { userId?: number; username?: string; firstName?: string; detail?: string },
): Promise<void> {
  try {
    await db.vipMemberEvent.create({
      data: {
        channelChatId,
        kind,
        userId: extra?.userId,
        username: extra?.username,
        firstName: extra?.firstName,
        detail: extra?.detail?.slice(0, 500),
      },
    });
  } catch (e) {
    console.warn("[vip] event log failed:", (e as Error).message);
  }
}

/** Full live status — bot identity, channel reachability, bot admin rights, head-count. */
export async function getVipStatus(): Promise<VipStatus> {
  const [bot, chatId, autoApproveRaw] = await Promise.all([
    verifyBot(),
    getVipChatId(),
    getSetting(SETTING_KEYS.vipAutoApprove),
  ]);

  const empty: VipStatus = {
    bot: { connected: bot.connected, username: bot.username, displayName: bot.displayName, botId: bot.botId, error: bot.error },
    channel: { configured: false, reachable: false, chatId: chatId ?? "", error: chatId ? undefined : "not_configured" },
    rights: { ok: false, error: "channel_not_configured" },
    memberCount: { ok: false, error: "channel_not_configured" },
    admins: { ok: false, error: "channel_not_configured" },
    autoApprove: autoApproveRaw === "1",
  };

  if (!bot.connected || !chatId) return empty;

  const [chat, memberCount, admins] = await Promise.all([
    inspectChat(chatId),
    getChatMemberCount(chatId),
    getChatAdministrators(chatId),
  ]);

  // Bot self-rights inside the VIP channel — the real management capabilities.
  const botId = bot.botId;
  let rights: VipStatus["rights"] = { ok: false, error: "unknown" };
  if (botId) {
    const m = await getChatMember(chatId, botId);
    if (m.ok && m.result) {
      const r: ChatMemberInfo = m.result;
      rights = {
        ok: r.status === "administrator" || r.status === "creator",
        status: r.status,
        canInviteUsers: r.canInviteUsers,
        canRestrictMembers: r.canRestrictMembers,
        canApproveMembers: r.canApproveMembers,
        canPostMessages: r.canPostMessages,
      };
    } else {
      rights = { ok: false, error: m.error };
    }
  }

  return {
    bot: { connected: true, username: bot.username, displayName: bot.displayName, botId: bot.botId },
    channel: {
      configured: true,
      reachable: chat.reachable,
      chatId,
      title: chat.title,
      type: chat.type,
      error: chat.error,
    },
    rights,
    memberCount,
    admins,
    autoApprove: autoApproveRaw === "1",
  };
}

/* ---------------- dedicated invite links ---------------- */

export interface CreateLinkInput {
  label: string;
  memberLimit?: number | null; // null/0 → unlimited
  expiresInHours?: number | null; // null/0 → never
  createsJoinRequest?: boolean;
}

/** Mint a dedicated VIP invite link (real Telegram call + audit row). */
export async function createDedicatedLink(
  input: CreateLinkInput,
): Promise<{ ok: boolean; link?: VipLinkRow; error?: string }> {
  const chatId = await getVipChatId();
  if (!chatId) return { ok: false, error: "کانال VIP تنظیم نشده است" };
  const label = input.label.trim();
  if (!label) return { ok: false, error: "برچسب لینک الزامی است" };

  const expireDate =
    input.expiresInHours && input.expiresInHours > 0
      ? Math.floor(Date.now() / 1000) + Math.floor(input.expiresInHours * 3600)
      : undefined;

  const r = await createChatInviteLink(chatId, {
    name: label.slice(0, 32),
    memberLimit: input.memberLimit && input.memberLimit > 0 ? input.memberLimit : undefined,
    expireDate,
    createsJoinRequest: input.createsJoinRequest ?? false,
  });
  if (!r.ok || !r.result) return { ok: false, error: r.error ?? "createChatInviteLink_failed" };

  const row = await db.vipInviteLink.create({
    data: {
      channelChatId: chatId,
      link: r.result.link,
      tgLinkId: r.result.tgLinkId,
      label,
      memberLimit: input.memberLimit && input.memberLimit > 0 ? input.memberLimit : null,
      expireAt: expireDate ? new Date(expireDate * 1000) : null,
    },
  });
  await logVipEvent(chatId, "LINK_CREATED", {
    detail: `label="${label}" limit=${input.memberLimit ?? "∞"} ttl=${input.expiresInHours ?? "never"}h`,
  });

  return {
    ok: true,
    link: {
      id: row.id,
      label: row.label,
      link: row.link,
      memberLimit: row.memberLimit,
      expireAt: row.expireAt?.toISOString() ?? null,
      isRevoked: row.isRevoked,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    },
  };
}

/** Revoke a dedicated link on Telegram AND stamp the audit row. */
export async function revokeLink(id: string): Promise<{ ok: boolean; error?: string }> {
  const row = await db.vipInviteLink.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "لینک یافت نشد" };
  if (row.isRevoked) return { ok: true };
  const r = await revokeChatInviteLink(row.channelChatId, row.link);
  if (!r.ok) return { ok: false, error: r.error ?? "revokeChatInviteLink_failed" };
  await db.vipInviteLink.update({ where: { id }, data: { isRevoked: true, revokedAt: new Date() } });
  await logVipEvent(row.channelChatId, "LINK_REVOKED", { detail: `label="${row.label}"` });
  return { ok: true };
}

export async function listLinks(take = 40): Promise<VipLinkRow[]> {
  const rows = await db.vipInviteLink.findMany({ orderBy: { createdAt: "desc" }, take });
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    link: row.link,
    memberLimit: row.memberLimit,
    expireAt: row.expireAt?.toISOString() ?? null,
    isRevoked: row.isRevoked,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/* ---------------- join requests ---------------- */

export async function listJoinRequests(take = 40): Promise<VipRequestRow[]> {
  const rows = await db.vipJoinRequest.findMany({ orderBy: { createdAt: "desc" }, take });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    username: row.username,
    status: row.status,
    handledAt: row.handledAt?.toISOString() ?? null,
    handledBy: row.handledBy,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Approve a pending join request — a REAL approveChatJoinRequest call. */
export async function approveJoinRequest(
  id: string,
  handledBy: "auto" | "admin",
): Promise<{ ok: boolean; error?: string }> {
  const row = await db.vipJoinRequest.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "درخواست یافت نشد" };
  if (row.status !== "PENDING") return { ok: false, error: `درخواست قبلاً ${row.status} شده` };
  const r = await approveChatJoinRequest(row.channelChatId, row.userId);
  if (!r.ok) return { ok: false, error: r.error ?? "approveChatJoinRequest_failed" };
  await db.vipJoinRequest.update({
    where: { id },
    data: { status: "APPROVED", handledAt: new Date(), handledBy },
  });
  await logVipEvent(row.channelChatId, handledBy === "auto" ? "AUTO_APPROVED" : "ADMIN_ACTION", {
    userId: row.userId,
    username: row.username ?? undefined,
    firstName: row.firstName ?? undefined,
    detail: handledBy === "auto" ? "join request auto-approved" : "join request approved by admin",
  });
  return { ok: true };
}

/** Decline a pending join request — a REAL declineChatJoinRequest call. */
export async function declineJoinRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  const row = await db.vipJoinRequest.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "درخواست یافت نشد" };
  if (row.status !== "PENDING") return { ok: false, error: `درخواست قبلاً ${row.status} شده` };
  const r = await declineChatJoinRequest(row.channelChatId, row.userId);
  if (!r.ok) return { ok: false, error: r.error ?? "declineChatJoinRequest_failed" };
  await db.vipJoinRequest.update({
    where: { id },
    data: { status: "DECLINED", handledAt: new Date(), handledBy: "admin" },
  });
  await logVipEvent(row.channelChatId, "ADMIN_ACTION", {
    userId: row.userId,
    username: row.username ?? undefined,
    firstName: row.firstName ?? undefined,
    detail: "join request declined by admin",
  });
  return { ok: true };
}

/* ---------------- member control ---------------- */

/** Kick (ban+unban) a member from the VIP channel — real banChatMember call. */
export async function kickMember(userId: number): Promise<{ ok: boolean; error?: string }> {
  const chatId = await getVipChatId();
  if (!chatId) return { ok: false, error: "کانال VIP تنظیم نشده است" };
  const r = await kickChatMember(chatId, userId);
  if (!r.ok) return { ok: false, error: r.error ?? "kick_failed" };
  await logVipEvent(chatId, "MEMBER_KICKED", { userId, detail: "kicked by admin via studio" });
  return { ok: true };
}

/* ---------------- switches ---------------- */

export async function setAutoApprove(enabled: boolean): Promise<void> {
  await setSetting(SETTING_KEYS.vipAutoApprove, enabled ? "1" : "0");
}

export async function getAutoApprove(): Promise<boolean> {
  const v = await getSetting(SETTING_KEYS.vipAutoApprove);
  return v === "1";
}

export async function recentEvents(take = 30): Promise<VipEventRow[]> {
  const rows = await db.vipMemberEvent.findMany({ orderBy: { createdAt: "desc" }, take });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    userId: row.userId,
    username: row.username,
    firstName: row.firstName,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Upsert a join request row from the live updates stream (idempotent per user). */
export async function upsertJoinRequest(chatId: string, user: Record<string, unknown>): Promise<"created" | "existing"> {
  const userId = Number(user.id);
  if (!Number.isFinite(userId)) return "existing";
  const open = await db.vipJoinRequest.findFirst({
    where: { channelChatId: chatId, userId, status: "PENDING" },
  });
  if (open) return "existing";
  await db.vipJoinRequest.create({
    data: {
      channelChatId: chatId,
      userId,
      firstName: typeof user.first_name === "string" ? user.first_name : null,
      lastName: typeof user.last_name === "string" ? user.last_name : null,
      username: typeof user.username === "string" ? user.username : null,
      bio: typeof user.bio === "string" ? user.bio : null,
    },
  });
  await logVipEvent(chatId, "JOIN_REQUEST", {
    userId,
    username: typeof user.username === "string" ? user.username : undefined,
    firstName: typeof user.first_name === "string" ? user.first_name : undefined,
  });
  return "created";
}
