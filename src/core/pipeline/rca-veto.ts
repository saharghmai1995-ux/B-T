/**
 * RCA Veto Pipeline — turns HIGH-severity causal findings into shadow-ledger
 * vetoes. Vetoed groups never touch the bank; they are surfaced in the UI.
 */

import { db } from "@/lib/db";
import { runRca, type QqlRow } from "@/core/rca/qql-rca-engine";

function toQqlRows(rows: Array<Record<string, unknown>>): QqlRow[] {
  return rows.map((r) => ({
    id: String(r.id), sport: String(r.sport), league: String(r.league),
    line: String(r.line), marketLabel: String(r.marketLabel), selection: String(r.selection),
    status: String(r.status), price: Number(r.price), evPct: Number(r.evPct),
    stake: Number(r.stake), netProfit: Number(r.netProfit), matchInfo: String(r.matchInfo),
  }));
}

/** Analyze recent settled rows and persist new HIGH-severity vetoes. */
export async function runRcaVetoes(): Promise<number> {
  const settled = await db.signal.findMany({
    where: { status: { in: ["WON", "LOST"] } },
    include: { match: { select: { homeName: true, awayName: true, league: true } } },
    orderBy: { settledAt: "desc" },
    take: 120,
  });
  if (settled.length < 6) return 0;
  const qqlRows: QqlRow[] = settled.map((s) => ({
    id: s.id, sport: s.sport, league: s.match.league, line: s.line,
    marketLabel: s.marketLabel, selection: s.selection, status: s.status,
    price: s.price, evPct: s.evPct, stake: s.stake, netProfit: s.netProfit ?? 0,
    matchInfo: `${s.match.homeName} vs ${s.match.awayName}`,
  }));
  void toQqlRows;
  const findings = [...runRca(qqlRows, "league"), ...runRca(qqlRows, "line")];
  const high = findings.filter((f) => f.severity === "HIGH");
  let created = 0;
  for (const f of high) {
    const reason = `${f.hypothesis} | ${f.recommendation}`;
    const exists = await db.shadowVeto.findFirst({
      where: { signalRef: f.group, category: "league" },
    });
    if (exists) continue;
    await db.shadowVeto.create({
      data: { signalRef: f.group, reason, category: "league" },
    });
    created++;
  }
  return created;
}

export { toQqlRows };
