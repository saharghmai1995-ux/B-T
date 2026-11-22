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
