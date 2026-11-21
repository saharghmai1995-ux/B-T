import { NextResponse } from "next/server";
import { runIngest } from "@/core/pipeline/ingest-service";
import { bootstrapState } from "@/core/pipeline/bootstrap-service";
import { seedRealHistory } from "@/core/pipeline/real-history-backfill";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/ingest — live sync: fixtures, odds, settlement of FT results. */
export async function POST(req: Request) {
  try {
    let reseed = false;
    try {
      const body = (await req.json()) as { reseedHistory?: boolean } | null;
      reseed = body?.reseedHistory === true;
    } catch {
      // empty body → plain ingest
    }
    const summary = await runIngest();
    const seed = reseed ? await seedRealHistory({ force: true }) : null;
    if (reseed) {
      // force reseed rebuilt the ledger from real history — reset sync marker
      await db.ingestState.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", lastRun: new Date(), lastSummary: JSON.stringify(summary) },
        update: { lastRun: new Date(), lastSummary: JSON.stringify(summary) },
      });
    }
    const state = await bootstrapState({ ingestSummary: summary, historySeed: seed });
    return NextResponse.json({ ok: true, summary, historySeed: seed, state });
  } catch (err) {
    console.error("ingest failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "ingest failed" },
      { status: 500 },
    );
  }
}

/** GET /api/ingest — lightweight last-state refresh (no network). */
export async function GET() {
  const state = await bootstrapState();
  return NextResponse.json({ ok: true, state });
}
