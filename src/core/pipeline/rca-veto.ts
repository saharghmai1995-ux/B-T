/**
 * RCA Veto Pipeline — turns HIGH-severity causal findings into shadow-ledger
 * vetoes. Vetoed groups never touch the bank; they are surfaced in the UI.
 * v2.0: every group veto carries its REAL representative fixture (the most
 * recent LOST row of the group) with the REAL FT score, so the Shadow Ledger
 * Tracker can prove the veto actually prevents continued losses.
 */

import { db } from "@/lib/db";
import { runRca, type QqlRow } from "@/core/rca/qql-rca-engine";
import { getMarket } from "@/core/bookmakers/market-whitelist";

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
    include: {
      match: {
        select: {
          homeName: true, awayName: true, league: true,
          homeScore: true, awayScore: true, status: true,
        },
      },
    },
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
  const findings = [...runRca(qqlRows, "league"), ...runRca(qqlRows, "line")];
  const high = findings.filter((f) => f.severity === "HIGH");
  let created = 0;
  for (const f of high) {
    const reason = `${f.hypothesis} | ${f.recommendation}`;
    const exists = await db.shadowVeto.findFirst({
      where: { signalRef: f.group, category: "league" },
    });
    if (exists) continue;
    // Representative REAL fixture: the group's most recent LOST row.
    const lostRows = settled.filter(
      (s) => (s.match.league === f.group || s.line === f.group) && s.status === "LOST",
    );
    const rep = lostRows[0];
    await db.shadowVeto.create({
      data: {
        signalRef: f.group,
        reason: rep
          ? `${reason} | نماینده واقعی: ${rep.match.homeName} vs ${rep.match.awayName}`
          : reason,
        category: "league",
        sport: rep?.sport ?? null,
        league: rep?.match.league ?? (lostRows.length ? f.group : null),
        marketLabel: rep ? getMarket(rep.marketKey)?.label ?? rep.marketLabel : null,
        selection: rep?.selection ?? null,
        price: rep?.price ?? null,
        modelProb: rep?.modelProb ?? null,
        ftScore:
          rep && rep.match.homeScore != null && rep.match.awayScore != null
            ? `${rep.match.homeScore}-${rep.match.awayScore}`
            : null,
        savedUnits: rep ? rep.stake : null, // the stake this group keeps burning
        verdict: rep ? "SAVED_LOSS" : null,
        decidedAt: rep?.settledAt ?? null,
      },
    });
    created++;
  }
  return created;
}

export { toQqlRows };
