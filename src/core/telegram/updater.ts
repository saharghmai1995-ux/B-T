/**
 * Telegram Updater (v3.4) — the LIVE heartbeat of @Aineobet_bot.
 *
 * A self-healing in-process long-poll loop (booted together with the Warm
 * Engine → fully browser-independent):
 *   • getUpdates long-poll (25s) with persisted offset — survives restarts
 *   • chat_join_request  → VipJoinRequest row + optional AUTO-APPROVE
 *   • chat_member        → MEMBER_JOINED / MEMBER_LEFT events
 *   • my_chat_member     → bot admin status transitions
 *   • private /start /id /help commands → real replies
 *   • mutex + error backoff: the loop can never overlap or crash the server
 */

import { db } from "@/lib/db";
import { SETTING_KEYS, getSetting, setSetting } from "@/core/pipeline/settings";
import { getUpdates, sendChatMessage, approveChatJoinRequest, type TgUpdate } from "@/core/telegram/bot-client";
import { getVipChatId, logVipEvent, upsertJoinRequest, getAutoApprove } from "@/core/telegram/vip-service";

const POLL_SECONDS = 25;
const IDLE_DELAY_MS = 1_500;
const ERROR_BACKOFF_MS = 10_000;
const FIRST_POLL_DELAY_MS = 5_000;

interface UpdaterState {
  started: boolean;
  running: boolean;
  lastPollAt: number | null;
  lastOkAt: number | null;
  lastOffset: number | null;
  processed: number;
  errors: number;
  lastError: string | null;
}

const globalUpdater = globalThis as unknown as { __neobetTgUpdater?: UpdaterState };

const state =
  globalUpdater.__neobetTgUpdater ??
  (globalUpdater.__neobetTgUpdater = {
    started: false, running: false, lastPollAt: null, lastOkAt: null,
    lastOffset: null, processed: 0, errors: 0, lastError: null,
  });

export function updaterStats(): {
  started: boolean;
  running: boolean;
  lastPollAt: string | null;
  lastOkAt: string | null;
  lastOffset: number | null;
  processed: number;
  errors: number;
  lastError: string | null;
} {
  return {
    started: state.started,
    running: state.running,
    lastPollAt: state.lastPollAt ? new Date(state.lastPollAt).toISOString() : null,
    lastOkAt: state.lastOkAt ? new Date(state.lastOkAt).toISOString() : null,
    lastOffset: state.lastOffset,
    processed: state.processed,
    errors: state.errors,
    lastError: state.lastError,
  };
}

/* ---------------- handlers ---------------- */

async function handleJoinRequest(u: TgUpdate): Promise<void> {
  const req = u.chat_join_request as {
    chat?: Record<string, unknown>;
    from?: Record<string, unknown>;
  } | null;
  if (!req?.chat || !req.from) return;
  const chatId = String(req.chat.id);
  const userId = Number(req.from.id);

  const created = await upsertJoinRequest(chatId, req.from);
  if (!created) return;

  // Optional auto-approve — a REAL approveChatJoinRequest call, never assumed.
  if (await getAutoApprove()) {
    const r = await approveChatJoinRequest(chatId, userId);
    if (r.ok) {
      const row = await db.vipJoinRequest.findFirst({
        where: { channelChatId: chatId, userId, status: "PENDING" },
      });
      if (row) {
        await db.vipJoinRequest.update({
          where: { id: row.id },
          data: { status: "APPROVED", handledAt: new Date(), handledBy: "auto" },
        });
      }
      await logVipEvent(chatId, "AUTO_APPROVED", {
        userId,
        username: typeof req.from.username === "string" ? req.from.username : undefined,
        firstName: typeof req.from.first_name === "string" ? req.from.first_name : undefined,
        detail: "auto-approved by VIP gate",
      });
    } else {
      await logVipEvent(chatId, "ADMIN_ALERT", {
        userId,
        detail: `auto-approve failed: ${r.error}`,
      });
    }
  }
}

async function handleChatMember(u: TgUpdate): Promise<void> {
  const cm = (u.chat_member ?? u.my_chat_member ?? null) as Record<string, unknown> | null;
  if (!cm) return;
  const chat = cm.chat as Record<string, unknown> | undefined;
  const newMember = cm.new_chat_member as Record<string, unknown> | undefined;
  const oldMember = cm.old_chat_member as Record<string, unknown> | undefined;
  if (!chat || !newMember) return;
  const chatId = String(chat.id);
  if (chat.type !== "channel") return;

  const user = newMember.user as Record<string, unknown> | undefined;
  if (!user) return;
  const userId = Number(user.id);
  const username = typeof user.username === "string" ? user.username : undefined;
  const firstName = typeof user.first_name === "string" ? user.first_name : undefined;
  const newStatus = String(newMember.status ?? "");
  const oldStatus = String(oldMember?.status ?? "");

  // my_chat_member — the bot's own admin status changed.
  if (newMember.user && (user as { is_bot?: boolean }).is_bot === true) {
    if (newStatus !== oldStatus) {
      await logVipEvent(chatId, "ADMIN_ALERT", { detail: `bot status: ${oldStatus || "none"} → ${newStatus}` });
    }
    return;
  }

  if (newStatus === "member" && oldStatus !== "member") {
    await logVipEvent(chatId, "MEMBER_JOINED", { userId, username, firstName });
    // Any pending request for this user is now implicitly approved by Telegram.
    await db.vipJoinRequest.updateMany({
      where: { channelChatId: chatId, userId, status: "PENDING" },
      data: { status: "APPROVED", handledAt: new Date(), handledBy: "auto" },
    });
  } else if (newStatus === "left" && oldStatus === "member") {
    await logVipEvent(chatId, "MEMBER_LEFT", { userId, username, firstName });
  } else if (newStatus === "kicked") {
    await logVipEvent(chatId, "MEMBER_KICKED", { userId, username, firstName, detail: "seen in updates stream" });
  }
}

async function handlePrivateCommand(u: TgUpdate): Promise<void> {
  const msg = u.message as
    | { chat?: Record<string, unknown>; from?: Record<string, unknown>; text?: string }
    | null;
  if (!msg?.chat || msg.chat.type !== "private") return;
  const from = msg.from as Record<string, unknown> | undefined;
  if (!from) return;
  const chatId = msg.chat.id as string | number;
  const text = String(msg.text ?? "").trim();
  const uid = Number(from.id);
  const uname = typeof from.username === "string" ? `@${from.username}` : "";
  const fname = typeof from.first_name === "string" ? from.first_name : "کاربر";

  if (text.startsWith("/start")) {
    await sendChatMessage(
      chatId,
      `<b>NeoBet Quant Pro — VIP Gate</b>\n\n` +
        `سلام <b>${fname}</b> 👋\n` +
        `این ربات دروازه‌ی اختصاصی کانال VIP است.\n\n` +
        `/id — نمایش شناسه عددی حساب شما\n` +
        `/help — راهنما\n\n` +
        `لینک اختصاصی VIP از طریق پنل مدیریت برای شما ساخته می‌شود.`,
    );
  } else if (text.startsWith("/id")) {
    await sendChatMessage(
      chatId,
      `<b>Your Telegram ID</b>\n\n` +
        `ID: <code>${uid}</code>\n` +
        (uname ? `Username: <code>${uname}</code>\n` : "") +
        `این شناسه را برای ساخت لینک اختصاصی VIP در اختیار پشتیبانی قرار دهید.`,
    );
  } else if (text.startsWith("/help")) {
    await sendChatMessage(
      chatId,
      `<b>Commands</b>\n` +
        `/start — خوش‌آمد و وضعیت دروازه VIP\n` +
        `/id — شناسه عددی حساب شما\n` +
        `/help — همین راهنما`,
    );
  }
}

/* ---------------- one poll sweep ---------------- */

export async function sweepOnce(): Promise<{ ok: boolean; processed: number; busy?: boolean; error?: string }> {
  // Mutex — never two concurrent getUpdates against the same bot (Telegram
  // answers a second concurrent poll with a 409 Conflict).
  if (state.running) return { ok: true, processed: 0, busy: true };
  state.running = true;
  try {
    const offsetRaw = await getSetting(SETTING_KEYS.telegramUpdateOffset);
    const offset = offsetRaw ? Number(offsetRaw) : 0;
    const r = await getUpdates(Number.isFinite(offset) ? offset : 0, POLL_SECONDS);
    if (!r.ok) {
      state.errors += 1;
      state.lastError = r.error ?? "getUpdates_failed";
      return { ok: false, processed: 0, error: r.error };
    }
    let maxId = offset;
    let count = 0;
    const vipChatId = await getVipChatId();
    for (const u of r.updates) {
      maxId = Math.max(maxId, u.update_id + 1);
      try {
        if (u.chat_join_request) {
          await handleJoinRequest(u);
          count++;
          continue;
        }
        if (u.chat_member || u.my_chat_member) {
          await handleChatMember(u);
          count++;
          continue;
        }
        if (u.message) {
          // Commands are answered anywhere they arrive (private flows only reply).
          await handlePrivateCommand(u);
          count++;
          continue;
        }
      } catch (e) {
        state.lastError = (e as Error).message;
        console.warn("[tg-updater] handler failed:", state.lastError);
      }
    }
    if (r.updates.length > 0 && maxId > offset) {
      await setSetting(SETTING_KEYS.telegramUpdateOffset, String(maxId));
      state.lastOffset = maxId;
    }
    state.processed += count;
    state.lastOkAt = Date.now();
    state.lastError = null;
    return { ok: true, processed: count };
  } finally {
    state.running = false;
  }
}

async function loop(): Promise<void> {
  let delay = IDLE_DELAY_MS;
  try {
    const r = await sweepOnce();
    state.lastPollAt = Date.now();
    if (!r.ok) delay = ERROR_BACKOFF_MS;
  } catch (e) {
    state.errors += 1;
    state.lastError = (e as Error).message;
    delay = ERROR_BACKOFF_MS;
  }
  const t = setTimeout(() => void loop(), delay);
  if (typeof t.unref === "function") t.unref();
}

/** Idempotent — booted with the Warm Engine (browser-independent heartbeat). */
export function startTelegramUpdater(): void {
  if (state.started) return;
  state.started = true;
  console.log("[tg-updater] started — @Aineobet_bot live long-poll every", POLL_SECONDS + "s (+1.5s idle)");
  const t = setTimeout(() => void loop(), FIRST_POLL_DELAY_MS);
  if (typeof t.unref === "function") t.unref();
}
