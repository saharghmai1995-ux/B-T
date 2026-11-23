"use client";

/**
 * QQL + AI RCA interactive console — v3.2 Zero-Bankroll Purge edition.
 *
 * v3.2 migration: the console is a pure CLIENT-side analyzer over the ledger
 * the parent (QuantLabView) builds from `state.settledSignals` with the v3.2
 * pure hit-rate schema. There is NO price / EV / stake / pnl anywhere:
 *   - rows carry the calibrated probability, tier, outcome (WON/PUSH/LOST),
 *     Brier error ((p - y)^2) and a deterministic Persian RCA root cause;
 *   - the preset chips + the full executed-query display are kept — the tiny
 *     QQL dialect now runs over the v3.2 fields (parsed in the browser);
 *   - the QC findings cards on top flag pure hit-rate outliers (low agent
 *     consensus, Tier S pushes, Brier outliers, sharp divergence) with the
 *     original severity styling;
 *   - RCA clustering groups LOST rows by league / market with win-rate
 *     semantics (no stake / no units / no profit language).
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Play, Sparkles } from "lucide-react";
import type { AppSignal } from "@/lib/api-types";

/* ──────────────────────────── row schema (v3.2) ─────────────────────── */

/** v3.2 pure hit-rate row — built by QuantLabView (buildQqlRows). */
export interface QqlRow {
  id: string;
  matchInfo: string;
  sport: string;
  league: string;
  /** Protected Market — the official market label of the shielded selection. */
  marketLabel: string;
  tier: string | null;
  /** Calibrated probability 0..1 = (noLossProb ?? modelProb). */
  calibratedProb: number;
  status: "WON" | "LOST" | "VOID";
  /** WON / PUSH (VOID→PUSH) / LOST. */
  outcome: "WON" | "PUSH" | "LOST";
  /** Brier error (p − y)^2 — decided rows only; PUSH → null (renders "—"). */
  brierError: number | null;
  /** SuperAgent consensus 0..100 (QC finding input). */
  consensusPct: number | null;
  /** Deterministic Persian root cause / kicker label. */
  rcaCause: string;
}

/** RCA kicker for WON rows (cell renders «—» + this kicker). */
export const RCA_CAUSE_WON = "پیش‌بینی درست";
/** RCA label for PUSH rows — hit-rate wording only (never mentions stakes). */
export const RCA_CAUSE_PUSH = "پوش — بازگشت کامل";

const RCA_CAUSE_SHARP = "واگرایی شارپ — احتمال خبر پنهان";
const RCA_CAUSE_LOW_CONSENSUS = "اجماع پایین اما صادر شده";
const RCA_CAUSE_OVERCONFIDENT = "اطمینان بیش از حد مدل (Overconfidence)";
const RCA_CAUSE_CALIBRATION = "انحراف کالیبراسیون در این دسته بازار";

const clamp01 = (v: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/**
 * Deterministic Persian RCA root cause (v3.2 — pure hit-rate semantics).
 * LOST clusters in priority order: sharp divergence → low consensus →
 * model overconfidence → generic calibration drift. WON → kicker, VOID → push.
 */
export function deriveRcaCause(
  status: QqlRow["status"],
  sharpAlert: boolean | null,
  consensusPct: number | null,
  calibratedProb: number,
): string {
  if (status === "WON") return RCA_CAUSE_WON;
  if (status === "VOID") return RCA_CAUSE_PUSH;
  if (sharpAlert) return RCA_CAUSE_SHARP;
  if (consensusPct != null && consensusPct < 80) return RCA_CAUSE_LOW_CONSENSUS;
  if (calibratedProb >= 0.8) return RCA_CAUSE_OVERCONFIDENT;
  return RCA_CAUSE_CALIBRATION;
}

/** Parent-side mapping (QuantLabView): settledSignals → v3.2 QQL rows. */
export function buildQqlRows(signals: AppSignal[]): QqlRow[] {
  return signals.map((s) => {
    const status: QqlRow["status"] =
      s.status === "WON" ? "WON" : s.status === "LOST" ? "LOST" : "VOID";
    const outcome: QqlRow["outcome"] = status === "VOID" ? "PUSH" : status;
    const calibratedProb = clamp01(s.noLossProb ?? s.modelProb);
    return {
      id: s.id,
      matchInfo: s.matchInfo,
      sport: s.sport,
      league: s.league,
      marketLabel: s.marketLabel,
      tier: s.tier,
      calibratedProb,
      status,
      outcome,
      // Brier error for DECIDED rows only: (p − y)^2 with y = 1 (WON) / 0 (LOST).
      brierError:
        outcome === "PUSH"
          ? null
          : (calibratedProb - (outcome === "WON" ? 1 : 0)) ** 2,
      consensusPct: s.consensusPct,
      rcaCause: deriveRcaCause(status, s.sharpAlert, s.consensusPct, calibratedProb),
    };
  });
}

/* ─────────────────── tiny client-side QQL dialect (v3.2) ─────────────── */

type FieldValue = string | number | null | undefined;

function fieldValue(row: QqlRow, field: string): FieldValue {
  switch (field) {
    case "sport": return row.sport;
    case "league": return row.league;
    case "marketlabel": return row.marketLabel;
    case "tier": return row.tier;
    case "outcome": return row.outcome;
    case "status": return row.status;
    case "matchinfo": return row.matchInfo;
    case "rcacause": return row.rcaCause;
    case "calibratedprob": return row.calibratedProb;
    case "briererror": return row.brierError;
    case "consensuspct": return row.consensusPct;
    default: return undefined;
  }
}

interface QqlCond {
  field: string;
  op: string;
  value: string | number;
}

interface QqlAst {
  op: "SELECT" | "RCA";
  where: QqlCond[];
  order?: { field: string; dir: "ASC" | "DESC" };
  limit?: number;
  rcaBy?: string;
}

function extractWhere(q: string, up: string): QqlCond[] {
  const mWhere = up.match(/WHERE\s+([\s\S]+?)(ORDER\s+BY|LIMIT|$)/);
  if (!mWhere || mWhere.index == null) return [];
  const raw = q
    .slice(mWhere.index + 5, mWhere.index + mWhere[0].length)
    .trim()
    .replace(/ORDER BY|LIMIT/gi, "");
  const conds: QqlCond[] = [];
  for (const chunk of raw.split(/\s+AND\s+/i)) {
    const m = chunk.trim().match(/^(\w+)\s*(>=|<=|!=|=|>|<|CONTAINS)\s*'?([^']+)'?$/i);
    if (!m) continue;
    const [, field, op, valRaw] = m;
    const v: string | number =
      Number.isFinite(Number(valRaw)) && op.toUpperCase() !== "CONTAINS"
        ? Number(valRaw)
        : valRaw.trim();
    conds.push({ field: field.toLowerCase(), op: op.toUpperCase(), value: v });
  }
  return conds;
}

function parseQql(query: string): QqlAst {
  const up = query.toUpperCase();
  if (up.startsWith("RCA")) {
    const ast: QqlAst = { op: "RCA", where: [] };
    ast.rcaBy = (up.match(/BY\s+(\w+)/)?.[1] ?? "league").toLowerCase();
    ast.where = extractWhere(query, up);
    return ast;
  }
  const ast: QqlAst = { op: "SELECT", where: extractWhere(query, up) };
  const mOrder = up.match(/ORDER\s+BY\s+(\w+)(\s+(ASC|DESC))?/);
  if (mOrder) {
    ast.order = { field: mOrder[1].toLowerCase(), dir: (mOrder[3] as "ASC" | "DESC") ?? "DESC" };
  }
  const mLimit = up.match(/LIMIT\s+(\d+)/);
  if (mLimit) ast.limit = Number(mLimit[1]);
  return ast;
}

function matchCond(row: QqlRow, c: QqlCond): boolean {
  const val = fieldValue(row, c.field);
  if (val === undefined) return true; // unknown field — pass-through (engine parity)
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

function runSelect(rows: QqlRow[], ast: QqlAst): QqlRow[] {
  let out = rows.filter((r) => ast.where.every((c) => matchCond(r, c)));
  const order = ast.order;
  if (order) {
    const f = order.field;
    const dir = order.dir;
    out = [...out].sort((a, b) => {
      const va = fieldValue(a, f);
      const vb = fieldValue(b, f);
      const na = Number(va);
      const nb = Number(vb);
      const numeric = va != null && vb != null && Number.isFinite(na) && Number.isFinite(nb);
      const cmp = numeric
        ? na - nb
        : String(va ?? "").localeCompare(String(vb ?? ""));
      return dir === "ASC" ? cmp : -cmp;
    });
  }
  if (ast.limit) out = out.slice(0, ast.limit);
  return out;
}

/* ─────────────────── QC findings (pure hit-rate cards) ────────────────── */

interface QcFinding {
  key: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  stat: string;
  hypothesis: string;
  recommendation: string;
}

const qcSeverity = (n: number, hi: number, md: number): QcFinding["severity"] =>
  n >= hi ? "HIGH" : n >= md ? "MEDIUM" : "LOW";

/** Deterministic QC outliers over the v3.2 rows — hit-rate semantics only. */
function buildQcFindings(rows: QqlRow[]): QcFinding[] {
  const findings: QcFinding[] = [];

  const lowConsensus = rows.filter(
    (r) => r.outcome === "LOST" && r.consensusPct != null && r.consensusPct < 80,
  );
  if (lowConsensus.length > 0) {
    const avg =
      lowConsensus.reduce((a, r) => a + (r.consensusPct ?? 0), 0) / lowConsensus.length;
    findings.push({
      key: "low-consensus",
      title: "سیگنال‌های با اجماع زیر ۸۰٪",
      severity: qcSeverity(lowConsensus.length, 5, 2),
      stat: `${lowConsensus.length} باخت · میانگین اجماع ${avg.toFixed(0)}%`,
      hypothesis:
        "اجماع سوپرایجنت‌ها هنگام صدور زیر آستانه ۸۰٪ بود — این خوشه از نظر اطلاعاتی ریسک بالایی دارد.",
      recommendation: "صدور سیگنال از خوشه‌های کم‌اجماع تا بازگشت وین‌ریت متوقف شود.",
    });
  }

  const tierSPushes = rows.filter((r) => r.outcome === "PUSH" && r.tier === "TIER_S");
  if (tierSPushes.length > 0) {
    findings.push({
      key: "tier-s-pushes",
      title: "پوش‌های Tier S",
      severity: "LOW",
      stat: `${tierSPushes.length} پوش · تیر S`,
      hypothesis:
        "سپرهای Tier S به نتیجه پوش رسیدند — سپر کار خود را انجام داد: نه برد قطعی و نه باخت.",
      recommendation:
        "ادامه صدور سپر در Tier S — پوش در این تیر رفتار کاملاً مورد انتظار مدل است.",
    });
  }

  const brierOutliers = rows.filter(
    (r) => r.outcome === "LOST" && r.brierError != null && r.brierError > 0.2,
  );
  if (brierOutliers.length > 0) {
    const worst = Math.max(...brierOutliers.map((r) => r.brierError ?? 0));
    findings.push({
      key: "brier-outliers",
      title: "بالت‌های Brier بالای 0.2",
      severity: qcSeverity(brierOutliers.length, 3, 1),
      stat: `${brierOutliers.length} باخت · بدترین Brier ${worst.toFixed(3)}`,
      hypothesis:
        "مدل با اطمینان بالا نتیجه را از دست داد — خط Brier بالای 0.2 یعنی احتمال کالیبره به‌شدت از واقعیت فاصله داشت.",
      recommendation:
        "بازکالیبراسیون پلت و بازبینی وزن‌های Ensemble در دسته‌های بازار این خوشه.",
    });
  }

  const sharpDivergence = rows.filter(
    (r) => r.outcome === "LOST" && r.rcaCause.startsWith("واگرایی شارپ"),
  );
  if (sharpDivergence.length > 0) {
    findings.push({
      key: "sharp-divergence",
      title: "واگرایی شارپ",
      severity: qcSeverity(sharpDivergence.length, 3, 1),
      stat: `${sharpDivergence.length} باخت · جریان شارپ مخالف`,
      hypothesis:
        "هوش شارپ بازار خلاف جهت مدل حرکت کرده — احتمال خبر پنهان پیش از شروع مسابقه نادیده گرفته شده است.",
      recommendation:
        "سیگنال‌های واگرا به صف بازبینی ناظر بروند و تا شفاف‌شدن جریان شارپ صادر نشوند.",
    });
  }

  return findings;
}

/* ─────────────── RCA clustering (hit-rate semantics, no money) ────────── */

interface RcaCluster {
  group: string;
  lossShare: number;
  winRate: number;
  losses: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
  hypothesis: string;
  recommendation: string;
}

const RCA_HYPOTHESES: Record<string, string> = {
  league: "کیفیت تیم‌ها در این لیگ از دید مدل بیش‌برآورد شده — وین‌ریت خوشه زیر آستانه است.",
  sport: "افت سیستمیک وین‌ریت در این رشته — پارامترهای سطح/فرم نیاز به بازکالیبراسیون دارند.",
  marketlabel: "این مارکت به‌طور سیستماتیک وین‌ریت پایین‌تری می‌دهد — احتمال کالیبره در آن بیش‌برآورد می‌شود.",
  tier: "این تیر اعتماد در دوره اخیر وین‌ریت زیر حد انتظار مدل دارد.",
  rcacause: "علت ریشه‌ای غالب در این خوشه باخت‌ها تکرار می‌شود — الگوی خطای سیستماتیک.",
};

/** Causal clusters over LOST rows (share of losses + cluster win-rate). */
function runRcaClient(rows: QqlRow[], by: string): RcaCluster[] {
  const totalLost = rows.filter((r) => r.outcome === "LOST").length;
  if (totalLost === 0) return [];
  const groups = new Map<string, QqlRow[]>();
  for (const r of rows) {
    const key = String(fieldValue(r, by) ?? "unknown").slice(0, 28);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const findings: RcaCluster[] = [];
  for (const [g, rs] of groups) {
    const lost = rs.filter((r) => r.outcome === "LOST").length;
    if (lost === 0) continue;
    const lossShare = lost / totalLost;
    const wins = rs.filter((r) => r.outcome === "WON").length;
    const winRate = wins + lost > 0 ? wins / (wins + lost) : 0;
    if (lossShare < 0.15 || winRate >= 0.45) continue;
    const severity: RcaCluster["severity"] =
      lossShare >= 0.4 && winRate < 0.3 ? "HIGH" : lossShare >= 0.25 ? "MEDIUM" : "LOW";
    findings.push({
      group: g,
      lossShare: Math.round(lossShare * 1000) / 10,
      winRate: Math.round(winRate * 1000) / 10,
      losses: lost,
      severity,
      hypothesis: RCA_HYPOTHESES[by] ?? RCA_HYPOTHESES.league,
      recommendation:
        severity === "HIGH"
          ? `وتوی موقت «${g}» در دفتر سایه تا بازگشت وین‌ریت خوشه به بالای ۴۵٪`
          : `کاهش صادرات سیگنال از خوشه «${g}» و پایش هفتگی وین‌ریت`,
    });
  }
  return findings.sort((a, b) => b.lossShare - a.lossShare);
}

/* ─────────────────────────── presets & columns ───────────────────────── */

const PRESETS: Array<{ title: string; sql: string }> = [
  { title: "🧾 باخت‌های اخیر", sql: "SELECT * WHERE outcome = LOST ORDER BY calibratedProb DESC LIMIT 10" },
  { title: "🏆 لیگ پریمیرشیپ", sql: "SELECT * WHERE league CONTAINS Premier ORDER BY calibratedProb DESC LIMIT 10" },
  { title: "🛡 فقط سپرهای پوش", sql: "SELECT * WHERE outcome = PUSH ORDER BY calibratedProb DESC LIMIT 10" },
  { title: "📉 باخت‌های Tier S", sql: "SELECT * WHERE tier = TIER_S AND outcome = LOST ORDER BY calibratedProb DESC LIMIT 10" },
  { title: "⚡ واگرایی شارپ", sql: "SELECT * WHERE rcaCause CONTAINS 'واگرایی شارپ' ORDER BY calibratedProb DESC LIMIT 10" },
  { title: "⚽ بالاترین احتمال کالیبره فوتبال", sql: "SELECT * WHERE sport = football AND outcome != PUSH ORDER BY calibratedProb DESC LIMIT 10" },
  { title: "🔬 RCA خوشه‌های زیان (لیگ)", sql: "RCA LOSSES BY league" },
  { title: "🔬 RCA خوشه‌های زیان (مارکت)", sql: "RCA LOSSES BY marketLabel" },
];

/** v3.2 result columns — exact order. */
const COLUMNS = [
  "Match",
  "Sport & League",
  "Protected Market",
  "Tier",
  "Calibrated Prob %",
  "Outcome (WON/PUSH/LOST)",
  "Brier Error ((p - y)^2)",
  "RCA Root Cause",
] as const;

const OUTCOME_CLS: Record<QqlRow["outcome"], string> = {
  WON: "text-emerald-300",
  PUSH: "text-amber-300",
  LOST: "text-red-300",
};

/* ───────────────────────────── component ─────────────────────────────── */

export function QqlConsole({ rows }: { rows: QqlRow[] }) {
  const [query, setQuery] = useState(PRESETS[0].sql);
  const [activePreset, setActivePreset] = useState<number | null>(0);
  const [kind, setKind] = useState<"SELECT" | "RCA" | null>(null);
  const [results, setResults] = useState<QqlRow[] | null>(null);
  const [clusters, setClusters] = useState<RcaCluster[] | null>(null);

  const scanned = rows.length;
  const qcFindings = useMemo(() => buildQcFindings(rows), [rows]);

  function run(q?: string) {
    const qq = (q ?? query).trim();
    if (!qq) return;
    try {
      const ast = parseQql(qq);
      setKind(ast.op);
      if (ast.op === "RCA") {
        const f = runRcaClient(rows, ast.rcaBy ?? "league");
        setClusters(f);
        setResults(null);
        if (f.length === 0) {
          toast.info("خوشه زیان متمرکزی یافت نشد", { description: `${rows.length} ردیف اسکن شد` });
        }
      } else {
        const out = runSelect(rows, ast);
        setResults(out);
        setClusters(null);
        if (out.length === 0) {
          toast.info("نتیجه‌ای یافت نشد", { description: `${rows.length} ردیف اسکن شد` });
        }
      }
    } catch (e) {
      toast.error("خطای QQL", { description: (e as Error).message });
    }
  }

  return (
    <div className="space-y-3" data-testid="qql-console">
      {rows.length === 0 && (
        <div className="glass p-3 text-[11px] leading-6 text-muted-foreground">
          هنوز سیگنال تسویه‌شده‌ای ثبت نشده است — ردیف‌های v3.2 (احتمال کالیبره، تیر، نتیجه، خط Brier و
          علت ریشه‌ای) پس از نخستین تسویه اینجا ظاهر می‌شوند.
        </div>
      )}

      {/* ── QC findings cards (top) — pure hit-rate outliers ────────────── */}
      {qcFindings.length > 0 && (
        <div className="space-y-2" data-testid="qql-qc-findings">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-200">
            <Sparkles className="size-3.5" />
            کارت‌های کیفیت سیگنال (QC Findings) — نرخ اصابت خالص
          </div>
          {qcFindings.map((f) => (
            <div
              key={f.key}
              className={cn(
                "glass p-3",
                f.severity === "HIGH" ? "border-red-500/40" : "border-amber-400/30",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold">{f.title}</span>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                    f.severity === "HIGH"
                      ? "bg-red-500/15 text-red-300"
                      : "bg-amber-400/15 text-amber-300",
                  )}
                >
                  {f.severity}
                </span>
              </div>
              <div className="num mt-1 text-[10px] text-slate-400">{f.stat}</div>
              <p className="mt-1.5 text-[11px] leading-5 text-slate-300">{f.hypothesis}</p>
              <p className="mt-1 text-[11px] leading-5 text-emerald-300">↳ {f.recommendation}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── query console ───────────────────────────────────────────────── */}
      <div className="glass p-3">
        <textarea
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActivePreset(null); // manual edit → no preset is active anymore
          }}
          rows={2}
          dir="ltr"
          className="num w-full resize-none rounded-lg border border-slate-800 bg-[#0A0F1C] p-2.5 text-left text-[11px] text-emerald-200 outline-none focus:border-emerald-500/50"
          placeholder="SELECT * WHERE tier = TIER_S AND outcome = LOST ORDER BY calibratedProb DESC LIMIT 10"
          aria-label="پرس‌وجوی QQL"
        />

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => run()}
            className="gap-1.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          >
            <Play className="size-3.5" />
            اجرا
          </Button>
          {PRESETS.map((p, i) => (
            <button
              key={p.sql}
              onClick={() => {
                setQuery(p.sql);
                setActivePreset(i);
                run(p.sql);
              }}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
                activePreset === i
                  ? "border-neon-cyan bg-cyan-500/10 text-cyan-200"
                  : "border-slate-800 bg-secondary/50 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200",
              )}
            >
              {p.title}
            </button>
          ))}
        </div>

        {/* full executed query — never truncated */}
        {activePreset !== null && (
          <div className="mt-2">
            <div className="mb-1 text-[10px] text-slate-400">کد کامل اجراشده:</div>
            <code
              dir="ltr"
              className="num block overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-[#0A0F1C] p-2.5 text-left text-[11px] leading-5 text-cyan-200"
            >
              {PRESETS[activePreset].sql}
            </code>
          </div>
        )}
      </div>

      {/* ── RCA cluster results ─────────────────────────────────────────── */}
      {kind === "RCA" && clusters && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-200">
            <Sparkles className="size-3.5" />
            تحلیل ریشه‌ای علّی (AI Causal RCA) — {scanned} ردیف اسکن‌شده
          </div>
          {clusters.length === 0 && (
            <div className="glass p-3 text-xs text-muted-foreground">
              خوشه زیان متمرکزی یافت نشد — وین‌ریت پرتفوی سالم است یا داده تسویه‌شده کافی وجود ندارد.
            </div>
          )}
          {clusters.map((f) => (
            <div
              key={f.group}
              className={cn(
                "glass p-3",
                f.severity === "HIGH" ? "border-red-500/40" : "border-amber-400/30",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold">{f.group}</span>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                    f.severity === "HIGH"
                      ? "bg-red-500/15 text-red-300"
                      : "bg-amber-400/15 text-amber-300",
                  )}
                >
                  {f.severity}
                </span>
              </div>
              <div className="num mt-1 text-[10px] text-slate-400">
                سهم از باخت‌ها {f.lossShare}% · وین‌ریت خوشه {f.winRate}% · {f.losses} باخت
              </div>
              <p className="mt-1.5 text-[11px] leading-5 text-slate-300">{f.hypothesis}</p>
              <p className="mt-1 text-[11px] leading-5 text-emerald-300">↳ {f.recommendation}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── SELECT results — v3.2 pure hit-rate table ───────────────────── */}
      {kind === "SELECT" && results && (
        <div className="glass overflow-hidden p-0">
          <div className="max-h-72 overflow-auto scroll-slim" dir="ltr">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-[#0C1220] text-slate-400">
                <tr>
                  {COLUMNS.map((h) => (
                    <th key={h} className="px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="num">
                {results.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800/60 hover:bg-secondary/40">
                    <td className="max-w-[180px] truncate px-2 py-1.5" title={r.matchInfo}>
                      {r.matchInfo}
                    </td>
                    <td
                      className="max-w-[160px] truncate px-2 py-1.5"
                      title={`${r.sport} · ${r.league}`}
                    >
                      {r.sport} · {r.league}
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-1.5" title={r.marketLabel}>
                      {r.marketLabel}
                    </td>
                    <td className="px-2 py-1.5 text-amber-200">{r.tier ?? "—"}</td>
                    <td className="px-2 py-1.5 text-emerald-300">
                      {(r.calibratedProb * 100).toFixed(1)}%
                    </td>
                    <td className={cn("px-2 py-1.5 font-bold", OUTCOME_CLS[r.outcome])}>
                      {r.outcome}
                    </td>
                    <td className="px-2 py-1.5 text-slate-300">
                      {r.brierError == null ? "—" : r.brierError.toFixed(3)}
                    </td>
                    <td className="px-2 py-1.5" dir="rtl">
                      {r.rcaCause === RCA_CAUSE_WON ? (
                        <span className="text-slate-400">
                          — <span className="text-[9px] text-slate-500">پیش‌بینی درست</span>
                        </span>
                      ) : (
                        <span className="block max-w-[220px] truncate" title={r.rcaCause}>
                          {r.rcaCause}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {results.length === 0 && (
            <div className="p-3 text-center text-[11px] text-muted-foreground">
              هیچ ردیفی با این پرس‌وجو مطابقت نداشت.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
