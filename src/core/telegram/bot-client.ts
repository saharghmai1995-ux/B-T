/**
 * Telegram Bot API client (v2.6) — connection, channel management, card delivery.
 *
 * Design rules:
 *  - The bot token resolves from the DB settings first, then `.env.local`
 *    TELEGRAM_BOT_TOKEN. It is NEVER returned to any client — masked only.
 *  - Every Telegram API error is surfaced honestly (description string), so
 *    the studio can show the real cause (bot not admin, chat not found, ...).
 *  - sendPhoto accepts a raw PNG buffer; sendMessage a plain text body.
 */

import {
  getTelegramBotToken,
  resolveBroadcastTarget,
  type BroadcastChannel,
} from "@/core/pipeline/settings";

const TG_API = "https://api.telegram.org";
const TG_TIMEOUT_MS = 12_000;

export interface BotIdentity {
  configured: boolean;
  connected: boolean;
  botId?: number;
  username?: string;
  displayName?: string;
  error?: string;
}

export interface ChatSummary {
  configured: boolean;
  reachable: boolean;
  chatId: string;
  title?: string;
  type?: string;
  username?: string;
  error?: string;
}

export interface SendResult {
  ok: boolean;
  transport: string;
  messageId?: number;
  error?: string;
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/** Low-level Bot API call with timeout + honest error passthrough. */
async function tgCall<T>(method: string, body?: Record<string, unknown>): Promise<TgResponse<T>> {
  const token = await getTelegramBotToken();
  if (!token) {
    return { ok: false, description: "Bot token not configured (Settings panel or .env.local)" };
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TG_TIMEOUT_MS);
  try {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
      cache: "no-store",
    });
    const j = (await res.json()) as TgResponse<T>;
    return j;
  } catch (e) {
    return { ok: false, description: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

/** getMe — verify the bot token is live and identify the bot. */
export async function verifyBot(): Promise<BotIdentity> {
  const token = await getTelegramBotToken();
  if (!token) return { configured: false, connected: false, error: "token_missing" };
  const r = await tgCall<{ id: number; username?: string; first_name?: string }>("getMe");
  if (!r.ok || !r.result) {
    return { configured: true, connected: false, error: r.description ?? "getMe_failed" };
  }
  return {
    configured: true,
    connected: true,
    botId: r.result.id,
    username: r.result.username,
    displayName: r.result.first_name,
  };
}

/** getChat — validate a channel/chat id and read its display metadata. */
export async function inspectChat(chatId: string): Promise<ChatSummary> {
  const base: ChatSummary = { configured: Boolean(chatId.trim()), reachable: false, chatId };
  if (!chatId.trim()) return { ...base, error: "not_configured" };
  const r = await tgCall<{
    id: number | string;
    title?: string;
    type: string;
    username?: string;
  }>("getChat", { chat_id: chatId.trim() });
  if (!r.ok || !r.result) {
    return { ...base, error: r.description ?? "getChat_failed" };
  }
  return {
    ...base,
    reachable: true,
    title: r.result.title,
    type: r.result.type,
    username: r.result.username,
  };
}

/** sendPhoto — push a rendered PNG card to a concrete chat/channel id. */
export async function sendPhotoTo(
  chatId: string,
  png: Uint8Array,
  caption?: string,
): Promise<SendResult> {
  const token = await getTelegramBotToken();
  if (!token) return { ok: false, transport: "sendPhoto", error: "token_missing" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TG_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    const blob = new Blob([new Uint8Array(png)], { type: "image/png" });
    form.append("photo", blob, "card.png");
    if (caption && caption.trim()) form.append("caption", caption.trim().slice(0, 1024));
    const res = await fetch(`${TG_API}/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
      signal: ctl.signal,
    });
    const j = (await res.json()) as TgResponse<{ message_id: number }>;
    if (!j.ok) return { ok: false, transport: "sendPhoto", error: j.description ?? "sendPhoto_failed" };
    return { ok: true, transport: "sendPhoto", messageId: j.result?.message_id };
  } catch (e) {
    return { ok: false, transport: "sendPhoto", error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

/** sendMessage — push a plain-text post (radar / report / education / news). */
export async function sendMessageTo(chatId: string, text: string): Promise<SendResult> {
  const r = await tgCall<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4096),
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
  if (!r.ok) return { ok: false, transport: "sendMessage", error: r.description ?? "sendMessage_failed" };
  return { ok: true, transport: "sendMessage", messageId: r.result?.message_id };
}

/**
 * Resolve the concrete chat id of a broadcast lane.
 * PUBLIC → public channel, VIP → VIP channel, DEFAULT → legacy single chat.
 */
export async function resolveTarget(channel: BroadcastChannel): Promise<string | null> {
  return resolveBroadcastTarget(channel);
}

/* =====================================================================
 * v3.4 — VIP access management primitives (@Aineobet_bot)
 * Every call is an honest Bot-API round-trip; failures surface verbatim.
 * ===================================================================== */

export interface InviteLinkPayload {
  link: string;
  tgLinkId?: string; // Telegram invite_link_id (present since Bot API 9.x)
  name?: string;
  memberLimit?: number;
  expireDate?: number; // unix seconds
  isRevoked?: boolean;
}

/** createChatInviteLink — mint a dedicated invite link for the VIP channel. */
export async function createChatInviteLink(
  chatId: string,
  opts: { name?: string; memberLimit?: number; expireDate?: number; createsJoinRequest?: boolean },
): Promise<{ ok: boolean; result?: InviteLinkPayload; error?: string }> {
  const body: Record<string, unknown> = { chat_id: chatId };
  if (opts.name?.trim()) body.name = opts.name.trim().slice(0, 32);
  if (opts.memberLimit && opts.memberLimit > 0) body.member_limit = opts.memberLimit;
  if (opts.expireDate && opts.expireDate > Math.floor(Date.now() / 1000)) body.expire_date = opts.expireDate;
  if (opts.createsJoinRequest) body.creates_join_request = true;
  const r = await tgCall<{
    invite_link: string;
    invite_link_id?: string;
    name?: string;
    member_limit?: number;
    expire_date?: number;
    is_revoked?: boolean;
  }>("createChatInviteLink", body);
  if (!r.ok || !r.result) return { ok: false, error: r.description ?? "createChatInviteLink_failed" };
  return {
    ok: true,
    result: {
      link: r.result.invite_link,
      tgLinkId: r.result.invite_link_id,
      name: r.result.name,
      memberLimit: r.result.member_limit,
      expireDate: r.result.expire_date,
      isRevoked: r.result.is_revoked,
    },
  };
}

/** revokeChatInviteLink — kill a dedicated link instantly (revoked links let nobody in). */
export async function revokeChatInviteLink(
  chatId: string,
  inviteLink: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await tgCall<InviteLinkPayload>("revokeChatInviteLink", {
    chat_id: chatId,
    invite_link: inviteLink,
  });
  if (!r.ok) return { ok: false, error: r.description ?? "revokeChatInviteLink_failed" };
  return { ok: true };
}

/** approveChatJoinRequest — admit a pending requester (requires can_invite_users). */
export async function approveChatJoinRequest(
  chatId: string,
  userId: number,
): Promise<{ ok: boolean; error?: string }> {
  const r = await tgCall<true>("approveChatJoinRequest", { chat_id: chatId, user_id: userId });
  if (!r.ok) return { ok: false, error: r.description ?? "approveChatJoinRequest_failed" };
  return { ok: true };
}

/** declineChatJoinRequest — silently reject a pending requester. */
export async function declineChatJoinRequest(
  chatId: string,
  userId: number,
): Promise<{ ok: boolean; error?: string }> {
  const r = await tgCall<true>("declineChatJoinRequest", { chat_id: chatId, user_id: userId });
  if (!r.ok) return { ok: false, error: r.description ?? "declineChatJoinRequest_failed" };
  return { ok: true };
}

/** banChatMember — kick from a channel (banChatMember + unbanChatMember classic kick). */
export async function kickChatMember(
  chatId: string,
  userId: number,
): Promise<{ ok: boolean; error?: string }> {
  const ban = await tgCall<true>("banChatMember", { chat_id: chatId, user_id: userId, until_date: 0 });
  if (!ban.ok) return { ok: false, error: ban.description ?? "banChatMember_failed" };
  // Lift the ban immediately so the user may re-buy access later.
  await tgCall<true>("unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
  return { ok: true };
}

export interface ChatMemberInfo {
  status: string; // creator | administrator | member | restricted | left | kicked
  customTitle?: string;
  isMember?: boolean;
  untilDate?: number;
  canInviteUsers?: boolean;
  canRestrictMembers?: boolean;
  canApproveMembers?: boolean;
  canPostMessages?: boolean;
  canEditMessages?: boolean;
  canDeleteMessages?: boolean;
}

/** getChatMember — read any member's status (also used for bot self-rights). */
export async function getChatMember(
  chatId: string,
  userId: number,
): Promise<{ ok: boolean; result?: ChatMemberInfo; error?: string }> {
  const r = await tgCall<Record<string, unknown>>("getChatMember", { chat_id: chatId, user_id: userId });
  if (!r.ok || !r.result) return { ok: false, error: r.description ?? "getChatMember_failed" };
  const m = r.result;
  return {
    ok: true,
    result: {
      status: String(m.status ?? "unknown"),
      customTitle: typeof m.custom_title === "string" ? m.custom_title : undefined,
      isMember: m.is_member === true,
      untilDate: typeof m.until_date === "number" ? m.until_date : undefined,
      canInviteUsers: m.can_invite_users === true,
      canRestrictMembers: m.can_restrict_members === true,
      canApproveMembers: m.can_approve_members === true,
      canPostMessages: m.can_post_messages === true,
      canEditMessages: m.can_edit_messages === true,
      canDeleteMessages: m.can_delete_messages === true,
    },
  };
}

/** getChatMemberCount — honest live head-count of the channel. */
export async function getChatMemberCount(
  chatId: string,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const r = await tgCall<number>("getChatMemberCount", { chat_id: chatId });
  if (!r.ok || typeof r.result !== "number") return { ok: false, error: r.description ?? "getChatMemberCount_failed" };
  return { ok: true, count: r.result };
}

export interface AdminRow {
  userId: number;
  status: string;
  username?: string;
  displayName?: string;
  isBot: boolean;
}

/** getChatAdministrators — the real admin board of the channel. */
export async function getChatAdministrators(
  chatId: string,
): Promise<{ ok: boolean; result?: AdminRow[]; error?: string }> {
  const r = await tgCall<Array<Record<string, unknown>>>("getChatAdministrators", { chat_id: chatId });
  if (!r.ok || !r.result) return { ok: false, error: r.description ?? "getChatAdministrators_failed" };
  return {
    ok: true,
    result: r.result.map((a) => {
      const u = (a.user ?? {}) as Record<string, unknown>;
      return {
        userId: Number(u.id ?? 0),
        status: String(a.status ?? "unknown"),
        username: typeof u.username === "string" ? u.username : undefined,
        displayName: typeof u.first_name === "string" ? u.first_name : undefined,
        isBot: u.is_bot === true,
      };
    }),
  };
}

export interface TgUpdate {
  update_id: number;
  message?: Record<string, unknown>;
  channel_post?: Record<string, unknown>;
  my_chat_member?: Record<string, unknown>;
  chat_member?: Record<string, unknown>;
  chat_join_request?: Record<string, unknown>;
}

/**
 * getUpdates — the long-poll of the live bot updates stream.
 * Own timeout envelope (poll seconds + network slack) — this is the ONLY
 * caller allowed to hang: it IS the heartbeat of the bot.
 */
export async function getUpdates(
  offset: number,
  pollSeconds = 25,
): Promise<{ ok: boolean; updates: TgUpdate[]; error?: string }> {
  const token = await getTelegramBotToken();
  if (!token) return { ok: false, updates: [], error: "token_missing" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), (pollSeconds + 6) * 1000);
  try {
    const res = await fetch(
      `${TG_API}/bot${token}/getUpdates?offset=${offset}&timeout=${pollSeconds}` +
        `&allowed_updates=${encodeURIComponent(
          JSON.stringify(["message", "channel_post", "my_chat_member", "chat_member", "chat_join_request"]),
        )}`,
      { signal: ctl.signal, cache: "no-store" },
    );
    const j = (await res.json()) as { ok: boolean; result?: TgUpdate[]; description?: string };
    if (!j.ok) return { ok: false, updates: [], error: j.description ?? "getUpdates_failed" };
    return { ok: true, updates: j.result ?? [] };
  } catch (e) {
    return { ok: false, updates: [], error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

/** sendMessage with keyboard-free HTML — reused by the updater for /start replies. */
export async function sendChatMessage(chatId: string | number, text: string): Promise<SendResult> {
  return sendMessageTo(String(chatId), text);
}
