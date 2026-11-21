import { NextResponse } from "next/server";
import { runIngest } from "@/core/pipeline/ingest-service";
import { bootstrapState } from "@/core/pipeline/bootstrap-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/ingest — live sync: fixtures, odds, settlement of FT results. */
export async function POST() {
  try {
    const summary = await runIngest();
    const state = await bootstrapState({ ingestSummary: summary });
    return NextResponse.json({ ok: true, summary, state });
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
