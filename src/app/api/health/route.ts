import { NextResponse } from "next/server";
import { warmEngineStats, getCachedAppState } from "@/core/pipeline/warm-engine";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — headless liveness probe (v3.3.2 Always-Warm).
 * No browser needed: an uptime monitor (curl / cron / gateway) can keep the
 * sandbox observable and prove the engine core + dashboard state are alive.
 */
export async function GET() {
  let dbOk = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const warm = warmEngineStats();
  const cached = getCachedAppState();
  return NextResponse.json(
    {
      ok: dbOk && warm.started,
      version: "v3.3.2",
      engine: {
        ...warm,
        lastTickAgeSec: warm.lastRun ? Math.round((Date.now() - new Date(warm.lastRun).getTime()) / 1000) : null,
        cachedStateGeneratedAt: cached?.generatedAt ?? null,
      },
      uptimeSec: Math.round(process.uptime()),
      now: new Date().toISOString(),
    },
    { status: dbOk && warm.started ? 200 : 503 },
  );
}
