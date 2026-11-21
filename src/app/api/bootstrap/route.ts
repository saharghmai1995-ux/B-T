import { NextResponse } from "next/server";
import { ensureBootstrapState, bootstrapState } from "@/core/pipeline/bootstrap-service";
import { setSetting, SETTING_KEYS } from "@/core/pipeline/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/bootstrap — the single load route (cold-start safe, never empty). */
export async function GET() {
  try {
    const state = await ensureBootstrapState();
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    console.error("bootstrap failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "bootstrap failed" },
      { status: 500 },
    );
  }
}

/** POST /api/bootstrap — persist user settings (API keys / telegram config). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, string>;
    const allowed: Array<[string, string]> = [
      [SETTING_KEYS.oddsApiKey, body.theOddsApiKey ?? ""],
      [SETTING_KEYS.oddsApiIoKey, body.oddsApiIoKey ?? ""],
      [SETTING_KEYS.telegramBotToken, body.telegramBotToken ?? ""],
      [SETTING_KEYS.telegramChatId, body.telegramChatId ?? ""],
    ];
    for (const [key, value] of allowed) {
      if (typeof value === "string" && value.trim().length > 0) {
        await setSetting(key, value.trim());
      }
    }
    const state = await bootstrapState();
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    console.error("settings save failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "save failed" },
      { status: 400 },
    );
  }
}
