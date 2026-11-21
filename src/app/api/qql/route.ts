import { NextResponse } from "next/server";
import { parseQql, runQql, runRca, type QqlRow } from "@/core/rca/qql-rca-engine";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST /api/qql — run an analytical query or causal RCA over the ledger. */
export async function POST(req: Request) {
  try {
    const { query } = (await req.json()) as { query: string };
    if (!query || query.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "Empty QQL query" }, { status: 400 });
    }
    const settled = await db.signal.findMany({
      where: { status: { in: ["WON", "LOST", "VOID", "OPEN"] } },
      include: { match: { select: { homeName: true, awayName: true, league: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const rows: QqlRow[] = settled.map((s) => ({
      id: s.id, sport: s.sport, league: s.match.league, line: s.line,
      marketLabel: s.marketLabel, selection: s.selection, status: s.status,
      price: s.price, evPct: s.evPct, stake: s.stake, netProfit: s.netProfit ?? 0,
      matchInfo: `${s.match.homeName} vs ${s.match.awayName}`,
    }));
    const ast = parseQql(query);
    if (ast.op === "RCA") {
      const findings = runRca(rows, ast.rcaBy ?? "league");
      return NextResponse.json({ ok: true, kind: "RCA", findings, scanned: rows.length });
    }
    const { rows: out } = runQql(rows, ast);
    return NextResponse.json({ ok: true, kind: "SELECT", rows: out, scanned: rows.length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "QQL failed" },
      { status: 400 },
    );
  }
}
