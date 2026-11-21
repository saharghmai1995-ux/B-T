"use client";

/**
 * QQL + AI RCA interactive console.
 * The query runs server-side (/api/qql) — the UI is a pure display.
 * Presets use clean Persian titles; the FULL executed query is always shown
 * in a mono code box under the button row (no "..." truncation).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Play, Sparkles, Loader2 } from "lucide-react";

interface QqlRow {
  id: string; sport: string; league: string; line: string; marketLabel: string;
  selection: string; status: string; price: number; evPct: number; stake: number;
  netProfit: number; matchInfo: string;
}
interface RcaFinding {
  group: string; lossShare: number; winRate: number; losses: number;
  severity: "LOW" | "MEDIUM" | "HIGH"; hypothesis: string; recommendation: string;
}

const PRESETS: Array<{ title: string; sql: string }> = [
  { title: "🧾 ضررهای اخیر", sql: "SELECT * WHERE status = LOST ORDER BY netProfit ASC LIMIT 10" },
  { title: "🏆 لیگ پریمیرشیپ", sql: "SELECT * WHERE league CONTAINS Premier ORDER BY evPct DESC LIMIT 10" },
  { title: "🔬 RCA خوشه‌های زیان (لیگ)", sql: "RCA LOSSES BY league" },
  { title: "🔬 RCA خوشه‌های زیان (خط تولید)", sql: "RCA LOSSES BY line" },
  { title: "💰 بالاترین EV فوتبال", sql: "SELECT * WHERE sport = football AND evPct > 5 ORDER BY evPct DESC LIMIT 10" },
];

export function QqlConsole() {
  const [query, setQuery] = useState(PRESETS[0].sql);
  const [activePreset, setActivePreset] = useState<number | null>(0);
  const [rows, setRows] = useState<QqlRow[] | null>(null);
  const [findings, setFindings] = useState<RcaFinding[] | null>(null);
  const [kind, setKind] = useState<"SELECT" | "RCA" | null>(null);
  const [scanned, setScanned] = useState(0);
  const [busy, setBusy] = useState(false);

  async function run(q?: string) {
    const qq = (q ?? query).trim();
    setBusy(true);
    try {
      const res = await fetch("/api/qql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: qq }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      setKind(j.kind);
      setRows(j.rows ?? null);
      setFindings(j.findings ?? null);
      setScanned(j.scanned ?? 0);
      if (!j.rows?.length && !j.findings?.length) {
        toast.info("نتیجه‌ای یافت نشد", { description: `${j.scanned} ردیف اسکن شد` });
      }
    } catch (e) {
      toast.error("خطای QQL", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
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
          placeholder="SELECT * WHERE sport = football AND evPct > 5"
          aria-label="پرس‌وجوی QQL"
        />

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => run()} disabled={busy} className="gap-1.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
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

      {kind === "RCA" && findings && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-200">
            <Sparkles className="size-3.5" />
            تحلیل ریشه‌ای علّی (AI Causal RCA) — {scanned} ردیف اسکن‌شده
          </div>
          {findings.length === 0 && (
            <div className="glass p-3 text-xs text-muted-foreground">
              خوشه زیان متمرکزی یافت نشد — پرتفوی سالم است یا داده تسویه‌شده کافی وجود ندارد.
            </div>
          )}
          {findings.map((f) => (
            <div key={f.group} className={cn("glass p-3", f.severity === "HIGH" ? "border-red-500/40" : "border-amber-400/30")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold">{f.group}</span>
                <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                  f.severity === "HIGH" ? "bg-red-500/15 text-red-300" : "bg-amber-400/15 text-amber-300")}>
                  {f.severity}
                </span>
              </div>
              <div className="num mt-1 text-[10px] text-slate-400">
                سهم زیان {f.lossShare}% · وین‌ریت {f.winRate}% · {f.losses} باخت
              </div>
              <p className="mt-1.5 text-[11px] leading-5 text-slate-300">{f.hypothesis}</p>
              <p className="mt-1 text-[11px] leading-5 text-emerald-300">↳ {f.recommendation}</p>
            </div>
          ))}
        </div>
      )}

      {kind === "SELECT" && rows && (
        <div className="glass overflow-hidden p-0">
          <div className="max-h-72 overflow-auto scroll-slim" dir="ltr">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-[#0C1220] text-slate-400">
                <tr>
                  {["match", "sport", "market", "sel", "price", "ev%", "stake", "pnl", "status"].map((h) => (
                    <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="num">
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800/60 hover:bg-secondary/40">
                    <td className="max-w-[180px] truncate px-2 py-1.5" title={r.matchInfo}>{r.matchInfo}</td>
                    <td className="px-2 py-1.5">{r.sport}</td>
                    <td className="px-2 py-1.5">{r.marketLabel}</td>
                    <td className="px-2 py-1.5">{r.selection}</td>
                    <td className="px-2 py-1.5">{r.price.toFixed(2)}</td>
                    <td className="px-2 py-1.5">{r.evPct.toFixed(1)}</td>
                    <td className="px-2 py-1.5">{r.stake}</td>
                    <td className={cn("px-2 py-1.5", r.netProfit > 0 ? "text-emerald-300" : r.netProfit < 0 ? "text-red-300" : "text-slate-400")}>
                      {r.netProfit.toFixed(1)}
                    </td>
                    <td className="px-2 py-1.5">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
