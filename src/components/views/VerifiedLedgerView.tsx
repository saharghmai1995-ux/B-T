"use client";

/**
 * View 4 — VerifiedLedgerView: SHA-256 verified record + shadow ledger.
 * Searchable/filterable table, expandable rows, hash-verify modal,
 * ESPN deep-links and CSV/JSON audit export.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/primitives";
import { useAppStore } from "@/lib/store";
import { lineLabel, marketLabelFa, selectionLabel, statusColor, fmtPrice, fmtUnits } from "@/lib/api-types";
import type { AppStatePayload, AppSignal } from "@/lib/api-types";
import { ChevronDown, Download, Search, ShieldCheck, ExternalLink, Ban } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function VerifiedLedgerView({ state }: { state: AppStatePayload }) {
  const { sportFilter } = useAppStore();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "WON" | "LOST" | "VOID">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verify, setVerify] = useState<AppSignal | null>(null);

  const rows = useMemo(() => {
    let r = state.settledSignals;
    if (sportFilter !== "all") r = r.filter((s) => s.sport === sportFilter);
    if (status !== "all") r = r.filter((s) => s.status === status);
    if (q.trim()) {
      const t = q.toLowerCase();
      r = r.filter((s) =>
        s.matchInfo.toLowerCase().includes(t) ||
        s.marketLabel.toLowerCase().includes(t) ||
        s.league.toLowerCase().includes(t) ||
        s.shaHash.toLowerCase().includes(t));
    }
    return r;
  }, [state.settledSignals, sportFilter, status, q]);

  function download(kind: "csv" | "json") {
    const data = rows.map((s) => ({
      id: s.id, match: s.matchInfo, league: s.league, sport: s.sport, line: s.line,
      market: s.marketLabel, selection: s.selection, price: s.price, evPct: s.evPct,
      stake: s.stake, status: s.status, netProfit: s.netProfit, sha256: s.shaHash,
      settledAt: s.settledAt, espn: s.espnUrl,
    }));
    const blob = kind === "json"
      ? new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      : new Blob([
          ["id", "match", "league", "sport", "line", "market", "selection", "price", "ev%", "stake", "status", "netProfit", "sha256", "settledAt", "espn"].join(","),
          "\n",
          ...data.map((d) => [d.id, `"${d.match}"`, `"${d.league}"`, d.sport, d.line, `"${d.market}"`, d.selection, d.price, d.evPct, d.stake, d.status, d.netProfit, d.sha256, d.settledAt, d.espn].join(",")),
        ], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neobet-audit-${Date.now()}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`خروجی ${kind.toUpperCase()} ممیزی دانلود شد`);
  }

  return (
    <div className="space-y-4" data-testid="ledger-view">
      <Card className="glass p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جستجو: بازی / لیگ / مارکت / هش…"
              className="h-9 border-slate-800 bg-secondary/50 pr-9 text-xs"
            />
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            {([["all", "همه"], ["WON", "برد"], ["LOST", "باخت"], ["VOID", "ابطال"]] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setStatus(k)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  status === k ? "bg-emerald-500/15 text-emerald-300" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 border-slate-700 text-xs" onClick={() => download("csv")}>
            <Download className="size-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 border-slate-700 text-xs" onClick={() => download("json")}>
            <Download className="size-3.5" /> JSON
          </Button>
        </div>
      </Card>

      {/* Shadow ledger (vetoes) */}
      {state.shadowVetoes.length > 0 && (
        <Card className="glass border-red-500/25 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-red-300">
            <Ban className="size-3.5" />
            دفتر سایه — وتوهای سرنخ RCA ({state.shadowVetoes.length})
          </div>
          <div className="space-y-1.5">
            {state.shadowVetoes.slice(0, 4).map((v) => (
              <div key={v.id} className="rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-slate-300">
                <span className="font-bold text-red-300">{v.signalRef}</span> — {v.reason.slice(0, 140)}
              </div>
            ))}
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="🔐"
          title="رکورد تسویه‌شده‌ای در این فیلتر نیست"
          sub="پس از پایان هر مسابقه، موتور تسویه نتیجه ESPN را با قوانین ۹۰ دقیقه فوتبال / تکمیل کامل تنیس ثبت و هش می‌کند."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.id} className="glass overflow-hidden">
              <button
                className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-right transition-colors hover:bg-secondary/40"
                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                aria-expanded={expanded === s.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span>{s.sport === "tennis" ? "🎾" : "⚽"}</span>
                    <span className="truncate text-xs font-bold">{s.matchInfo}</span>
                    <span className={cn("num text-[11px] font-bold", statusColor(s.status))}>
                      {s.status === "WON" ? `+${fmtUnits(s.netProfit ?? 0)}` : s.status === "LOST" ? fmtUnits(s.netProfit ?? 0) : s.status}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {s.league} · {marketLabelFa(s.marketKey)} {selectionLabel(s.selection)} @ {fmtPrice(s.price)}
                  </div>
                </div>
                <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded === s.id && "rotate-180")} />
              </button>
              {expanded === s.id && (
                <div className="border-t border-slate-800/70 bg-secondary/30 p-3">
                  <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                    <div><span className="text-muted-foreground">خط تولید:</span> {lineLabel(s.line)}</div>
                    <div><span className="text-muted-foreground">استیک:</span> <span className="num">{fmtUnits(s.stake, 0)}u ({s.stakeMode})</span></div>
                    <div><span className="text-muted-foreground">احتمال مدل:</span> <span className="num">{(s.modelProb * 100).toFixed(1)}%</span></div>
                    <div><span className="text-muted-foreground">تسویه:</span> <span className="num">{s.settledAt ? new Date(s.settledAt).toLocaleString("fa-IR") : "—"}</span></div>
                  </div>
                  {s.legs && (
                    <ul className="mt-2 space-y-1 text-[10px] text-slate-400">
                      {s.legs.map((l, i) => <li key={i}>· {l.label} @ {fmtPrice(l.price)}</li>)}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="num rounded-md border border-slate-700 bg-[#0A0F1C] px-2 py-1 text-[10px] text-emerald-300" dir="ltr">
                      SHA-256 {s.shaHash}
                    </span>
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-[10px] border-emerald-500/40 text-emerald-300" onClick={() => setVerify(s)}>
                      <ShieldCheck className="size-3" /> راستی‌آزمایی هش
                    </Button>
                    <a href={s.espnUrl} target="_blank" rel="noopener noreferrer" className="flex h-7 items-center gap-1 rounded-md border border-slate-700 px-2 text-[10px] text-slate-300 hover:border-emerald-500/40">
                      <ExternalLink className="size-3" /> espn.com
                    </a>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!verify} onOpenChange={(o) => !o && setVerify(null)}>
        <DialogContent className="border-slate-800 bg-[#0C1220]" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-emerald-400" />
              راستی‌آزمایی قفل پیش‌ازبازی (Pre-Match Lock)
            </DialogTitle>
          </DialogHeader>
          {verify && (
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                هش زیر پیش از شروع مسابقه روی {verify.matchInfo} قفل شده است. برای ممیزی مستقل، payload سیگنال
                (matchInfo + market + price + prob + stake + issuedAt) را با همین هش بازتولید کنید.
              </p>
              <div className="num break-all rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-left text-[10px] text-emerald-300" dir="ltr">
                {verify.shaHash}
              </div>
              <div className="text-[10px] text-slate-400">
                مارکت: {marketLabelFa(verify.marketKey)} {selectionLabel(verify.selection)} · ضریب {fmtPrice(verify.price)} · استیک {fmtUnits(verify.stake, 0)}u
              </div>
              <div className="rounded-lg border border-slate-800 bg-secondary/40 p-2 text-[10px] leading-5 text-slate-300">
                زنجیره: هر گره شامل prevHash گره قبلی است — دستکاری هر ردیف زنجیره ممیزی را می‌شکند.
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
