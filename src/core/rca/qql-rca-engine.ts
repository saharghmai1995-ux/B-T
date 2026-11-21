/**
 * QQL + AI Causal RCA Engine.
 * QQL: tiny analytical query language over settled/open rows.
 * RCA: rule-based causal analysis over loss clusters (league / sport / line /
 * market / odds-band) producing veto hypotheses for the shadow ledger.
 */

import type { SettledRow } from "@/core/types";

export interface QqlRow {
  id: string;
  sport: string;
  league: string;
  line: string;
  marketLabel: string;
  selection: string;
  status: string;
  price: number;
  evPct: number;
  stake: number;
  netProfit: number;
  matchInfo: string;
}

const FIELDS = ["sport", "league", "line", "status", "marketLabel", "selection", "matchInfo"] as const;
const NUM_FIELDS = ["price", "evPct", "stake", "netProfit"] as const;

export interface QqlAst {
  op: "SELECT" | "RCA";
  where: Array<{ field: string; op: string; value: string | number }>;
  order?: { field: string; dir: "ASC" | "DESC" };
  limit?: number;
  rcaBy?: string;
}

/** Tokenize + parse the small QQL grammar. */
export function parseQql(query: string): QqlAst {
  const t = query.trim().toUpperCase().startsWith("RCA")
    ? parseRca(query)
    : parseSelect(query);
  return t;
}

function parseRca(q: string): QqlAst {
  const up = q.toUpperCase();
  const ast: QqlAst = { op: "RCA", where: [] };
  const mBy = up.match(/BY\s+(\w+)/);
  ast.rcaBy = (mBy?.[1] ?? "league").toLowerCase();
  const where = extractWhere(q, up);
  ast.where = where;
  return ast;
}

function parseSelect(q: string): QqlAst {
  const up = q.toUpperCase();
  const ast: QqlAst = { op: "SELECT", where: extractWhere(q, up) };
  const mOrder = up.match(/ORDER\s+BY\s+(\w+)(\s+(ASC|DESC))?/);
  if (mOrder) ast.order = { field: mOrder[1].toLowerCase(), dir: (mOrder[3] as "ASC" | "DESC") ?? "DESC" };
  const mLimit = up.match(/LIMIT\s+(\d+)/);
  if (mLimit) ast.limit = Number(mLimit[1]);
  return ast;
}

function extractWhere(q: string, up: string): QqlAst["where"] {
  const mWhere = up.match(/WHERE\s+([\s\S]+?)(ORDER\s+BY|LIMIT|$)/);
  if (!mWhere) return [];
  const raw = q.slice(mWhere.index! + 5, mWhere.index! + mWhere[0].length).trim().replace(/ORDER BY|LIMIT/gi, "");
  const conds: QqlAst["where"] = [];
  for (const chunk of raw.split(/\s+AND\s+/i)) {
    const m = chunk.trim().match(/^(\w+)\s*(>=|<=|!=|=|>|<|CONTAINS)\s*'?([^']+)'?$/i);
    if (!m) continue;
    const [, field, op, valRaw] = m;
    const v = Number.isFinite(Number(valRaw)) && op !== "CONTAINS" ? Number(valRaw) : valRaw.trim();
    conds.push({ field: field.toLowerCase(), op: op.toUpperCase(), value: v });
  }
  return conds;
}

function matchCond(row: QqlRow, c: { field: string; op: string; value: string | number }): boolean {
  const val = (row as unknown as Record<string, unknown>)[c.field];
  if (val === undefined) return true;
  if (typeof c.value === "number") {
    const n = Number(val);
    switch (c.op) {
      case ">": return n > c.value;
      case "<": return n < c.value;
      case ">=": return n >= c.value;
      case "<=": return n <= c.value;
      case "=": return n === c.value;
      case "!=": return n !== c.value;
      default: return true;
    }
  }
  const s = String(val).toLowerCase();
  const w = String(c.value).toLowerCase();
  switch (c.op) {
    case "=": return s === w;
    case "!=": return s !== w;
    case "CONTAINS": return s.includes(w);
    default: return true;
  }
}

export function runQql(rows: QqlRow[], ast: QqlAst): { rows: QqlRow[]; ast: QqlAst } {
  let out = rows.filter((r) => ast.where.every((c) => matchCond(r, c)));
  if (ast.op === "SELECT" && ast.order) {
    const f = ast.order.field;
    out = [...out].sort((a, b) => {
      const va = (a as unknown as Record<string, unknown>)[f];
      const vb = (b as unknown as Record<string, unknown>)[f];
      const na = Number(va), nb = Number(vb);
      const cmp = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : String(va).localeCompare(String(vb));
      return ast.order!.dir === "ASC" ? cmp : -cmp;
    });
  }
  if (ast.limit) out = out.slice(0, ast.limit);
  return { rows: out, ast };
}

export interface RcaFinding {
  group: string;
  lossShare: number;
  winRate: number;
  losses: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
  hypothesis: string;
  recommendation: string;
}

const RCA_HYPOTHESES: Record<string, string> = {
  league: "غالب‌شدن لیک ناکارآمد؛ کیفیت تیم‌ها در این لیگ از دید مدل بیش‌برآورد شده است.",
  sport: "افت سیستمیک در این رشته؛ پارامترهای سرفیس/فرم نیاز به کالیبراسیون مجدد دارد.",
  line: "این خط تولید در شرایط فعلی سودده نیست؛ آستانه EV یا استیک باید سخت‌گیرانه‌تر شود.",
  marketlabel: "این مارکت در 1xBet به‌طور سیستماتیک ضعیف قیمت‌گذاری می‌شود؛ جریان شکار مارجین معکوس شده است.",
  oddsband: "باند ضریبی انتخاب‌شده بیش‌ازحد مارجین بوک‌میکر را جذب می‌کند.",
  evband: "سیگنال‌های با EV ظاهری بالا در عمل بدترین بازده را دارند — نشانه اورفیت مدل.",
};

/** AI Causal RCA — causal hypotheses over loss clusters. */
export function runRca(rows: QqlRow[], by: string = "league"): RcaFinding[] {
  const losses = rows.filter((r) => r.status === "LOST");
  const totalLoss = losses.reduce((a, r) => a + Math.abs(Math.min(0, r.netProfit)), 0);
  if (totalLoss <= 0) return [];
  const groups = new Map<string, QqlRow[]>();
  for (const r of rows) {
    const key = String((r as unknown as Record<string, unknown>)[by] ?? "unknown").slice(0, 28);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const findings: RcaFinding[] = [];
  for (const [g, rs] of groups) {
    const gLoss = rs
      .filter((r) => r.status === "LOST")
      .reduce((a, r) => a + Math.abs(Math.min(0, r.netProfit)), 0);
    if (gLoss <= 0) continue;
    const lossShare = gLoss / totalLoss;
    const wins = rs.filter((r) => r.status === "WON").length;
    const lost = rs.filter((r) => r.status === "LOST").length;
    const winRate = wins + lost > 0 ? wins / (wins + lost) : 0;
    if (lossShare < 0.15 || winRate >= 0.45) continue;
    const severity = lossShare >= 0.4 && winRate < 0.3 ? "HIGH" : lossShare >= 0.25 ? "MEDIUM" : "LOW";
    findings.push({
      group: g,
      lossShare: Math.round(lossShare * 1000) / 10,
      winRate: Math.round(winRate * 1000) / 10,
      losses: lost,
      severity,
      hypothesis: RCA_HYPOTHESES[by] ?? RCA_HYPOTHESES.league,
      recommendation:
        severity === "HIGH"
          ? `وتوی موقت «${g}» در دفتر سایه + حذف از سیگنال‌های تأییدشده`
          : `کاهش استیک به 50u روی «${g}» تا بازگشت وین‌ریت به بالای 45٪`,
    });
  }
  return findings.sort((a, b) => b.lossShare - a.lossShare);
}
