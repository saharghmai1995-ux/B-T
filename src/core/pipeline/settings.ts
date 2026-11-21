/**
 * Settings store — API keys and runtime configuration (DB-backed).
 */

import { db } from "@/lib/db";

export const SETTING_KEYS = {
  oddsApiKey: "theOddsApiKey",
  oddsApiIoKey: "oddsApiIoKey",
  telegramBotToken: "telegramBotToken",
  telegramChatId: "telegramChatId",
  lastTier: "lastTier",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * The Odds API v4 key resolution order:
 * 1. DB setting (saved from the Settings panel)
 * 2. `.env.local` THE_ODDS_API_KEY (server-only secret, git-ignored)
 * Never logged, never sent to the client — the panel shows a masked copy.
 */
export async function getOddsApiKey(): Promise<string | null> {
  const fromDb = await getSetting(SETTING_KEYS.oddsApiKey);
  if (fromDb && fromDb.trim()) return fromDb.trim();
  const fromEnv = process.env.THE_ODDS_API_KEY;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : null;
}

/** Masked public view of settings for the client (never leak full keys). */
export function maskSettings(s: Record<string, string>): Record<string, string> {
  const mask = (v?: string) => (v ? `${v.slice(0, 4)}••••${v.slice(-4)}` : "");
  return {
    theOddsApiKey: mask(s[SETTING_KEYS.oddsApiKey]),
    oddsApiIoKey: mask(s[SETTING_KEYS.oddsApiIoKey]),
    telegramBotToken: mask(s[SETTING_KEYS.telegramBotToken]),
    telegramChatId: s[SETTING_KEYS.telegramChatId] ?? "",
  };
}
