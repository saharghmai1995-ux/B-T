"use client";

/**
 * AppShell — the commercial web-app shell.
 * Desktop: collapsible RTL sidebar + sticky top command bar.
 * Mobile (<768px): glass bottom tab bar (PWA-like) with safe-area support.
 */

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore, type ViewKey } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtUnits } from "@/lib/api-types";
import type { AppStatePayload } from "@/lib/api-types";
import OverviewView from "@/components/views/OverviewView";
import SignalsHubView from "@/components/views/SignalsHubView";
import QuantLabView from "@/components/views/QuantLabView";
import VerifiedLedgerView from "@/components/views/VerifiedLedgerView";
import TelegramStudioView from "@/components/views/TelegramStudioView";
import BillingApiView from "@/components/views/BillingApiView";
import BetSlipDrawer from "@/components/layout/BetSlipDrawer";
import {
  LayoutDashboard, Crosshair, FlaskConical, ShieldCheck, Radio, Gem,
  ReceiptText, Search, RefreshCw, Menu,
} from "lucide-react";

const NAV: Array<{ key: ViewKey; label: string; short: string; icon: React.ElementType }> = [
  { key: "overview", label: "داشبورد عملکرد", short: "داشبورد", icon: LayoutDashboard },
  { key: "signals", label: "مرکز سیگنال‌ها", short: "سیگنال‌ها", icon: Crosshair },
  { key: "ledger", label: "کارنامه رسمی", short: "کارنامه", icon: ShieldCheck },
  { key: "lab", label: "آزمایشگاه کوانت", short: "آزمایشگاه", icon: FlaskConical },
  { key: "telegram", label: "استودیو تلگرام", short: "استودیو", icon: Radio },
  { key: "billing", label: "اشتراک، پرداخت و API", short: "حساب", icon: Gem },
];

const SPORTS: Array<{ key: "all" | "football" | "tennis"; label: string }> = [
  { key: "all", label: "🌐 همه" },
  { key: "football", label: "⚽ فوتبال" },
  { key: "tennis", label: "🎾 تنیس" },
];

const TIER_LABEL: Record<string, string> = {
  FREE: "Free User",
  PRO_VIP: "Pro VIP",
  ENTERPRISE: "Enterprise",
};

export function useAppState() {
  return useQuery<AppStatePayload>({
    queryKey: ["app-state"],
    queryFn: async () => {
      const res = await fetch("/api/bootstrap");
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "bootstrap failed");
      return j.state as AppStatePayload;
    },
    staleTime: 45_000,
    refetchInterval: 90_000,
  });
}

export default function AppShell() {
  const { view, sportFilter, tier, betslip, setView, setSportFilter, setTier, setBetslipOpen, searchQuery, setSearchQuery, syncing, setSyncing } = useAppStore();
  const qc = useQueryClient();
  const { data: state, isLoading, isError, error } = useAppState();

  useEffect(() => {
    if (isError) toast.error("بارگذاری ناموفق — دوباره تلاش کنید", { description: (error as Error)?.message });
  }, [isError, error]);

  const openCount = state?.openSignals.length ?? 0;
  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const todaySignals = state?.openSignals.filter((s) => s.dayKey === todayKey).length ?? 0;

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/ingest", { method: "POST" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      qc.setQueryData(["app-state"], j.state);
      toast.success("همگام‌سازی زنده کامل شد", {
        description: `مسابقات: ${j.summary.matchesUpserted} | سیگنال جدید: ${j.summary.signalsCreated} | تسویه: ${j.summary.settledCount}`,
      });
    } catch (e) {
      toast.error("همگام‌سازی ناموفق", { description: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  const navList = (
    <nav className="flex flex-col gap-1 p-3" aria-label="ناوبری اصلی">
      {NAV.map((n) => {
        const Icon = n.icon;
        const active = view === n.key;
        return (
          <button
            key={n.key}
            onClick={() => setView(n.key)}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
              active
                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                : "text-slate-300 hover:bg-secondary hover:text-foreground border border-transparent",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1 text-right font-medium">{n.label}</span>
            {n.key === "signals" && openCount > 0 && (
              <Badge className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400 num px-1.5 text-[10px]">
                {openCount}
              </Badge>
            )}
          </button>
        );
      })}
    </nav>
  );

  const sportSwitch = (
    <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
      {SPORTS.map((s) => (
        <button
          key={s.key}
          onClick={() => setSportFilter(s.key)}
          className={cn(
            "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
            sportFilter === s.key ? "bg-emerald-500/15 text-emerald-300" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-screen flex-col bg-background" dir="rtl">
        {/* ===== Sticky top command bar ===== */}
        <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#060911E6] backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-full max-w-[1500px] items-center gap-2 px-3 md:px-5">
            {/* Mobile menu */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="منو">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 border-slate-800 bg-sidebar p-0">
                <SheetTitle className="border-b border-slate-800 px-4 py-3 text-right text-sm font-bold">
                  NeoBet Quant Pro
                </SheetTitle>
                <div className="p-3">{sportSwitch}</div>
                {navList}
              </SheetContent>
            </Sheet>

            <button onClick={() => setView("overview")} className="flex items-center gap-2" aria-label="خانه">
              <span className="grid size-8 place-items-center rounded-xl bg-emerald-500/15 text-lg">⚡</span>
              <span className="hidden text-sm font-extrabold tracking-tight sm:block">
                NeoBet <span className="text-emerald-400">Quant Pro</span>
              </span>
            </button>

            <div className="relative mx-1 hidden flex-1 md:block">
              <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجوی سریع مسابقه… (⌘K)"
                className="h-9 border-slate-800 bg-secondary/50 pr-9 text-xs"
                aria-label="جستجوی مسابقه"
              />
            </div>

            <div className="flex-1 md:hidden" />

            {/* Feed health — honest LIVE vs SIM labeling */}
            {state?.health.mode === "SIM" ? (
              <div
                className="hidden items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 lg:flex"
                title="فید ESPN در دسترس نیست — داده‌ها از فید شبیه‌سازی قطعی (SIM) تأمین می‌شوند"
              >
                <span className="pulse-dot size-2 rounded-full bg-amber-400 text-amber-400" />
                <span className="text-[11px] text-amber-300">حالت شبیه‌سازی (SIM)</span>
              </div>
            ) : (
              <div className="hidden items-center gap-1.5 rounded-xl border border-slate-800 bg-secondary/50 px-2.5 py-1.5 lg:flex">
                <span className={cn("size-2 rounded-full", state?.health.espn ? "pulse-dot bg-emerald-400 text-emerald-400" : "bg-red-500 text-red-500")} />
                <span className="text-[11px] text-muted-foreground">1xBet / ESPN Live</span>
              </div>
            )}

            {/* Tier switch (demo paywall) */}
            <div className="hidden items-center rounded-xl border border-slate-800 bg-secondary/50 p-0.5 sm:flex">
              {(["FREE", "PRO_VIP", "ENTERPRISE"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTier(t)}
                  className={cn(
                    "rounded-lg px-2 py-1 text-[11px] transition-colors",
                    tier === t ? (t === "FREE" ? "bg-slate-700 text-slate-200" : t === "PRO_VIP" ? "vip-gold font-bold" : "bg-violet-500/25 text-violet-200") : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TIER_LABEL[t]}
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={syncNow}
              disabled={syncing}
              className="h-9 gap-1.5 border-slate-800 text-xs"
              aria-label="همگام‌سازی فوری"
            >
              <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
              <span className="hidden sm:inline">همگام‌سازی</span>
            </Button>

            <Button
              onClick={() => setBetslipOpen(true)}
              size="sm"
              className="h-9 gap-1.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
              aria-label="کشوی برگه شرط‌بندی"
            >
              <ReceiptText className="size-3.5" />
              <span className="num">{betslip.length}</span>
            </Button>
          </div>
        </header>

        {/* ===== Body ===== */}
        <div className="mx-auto flex w-full max-w-[1500px] flex-1 gap-4 px-3 pb-24 pt-4 md:px-5 md:pb-6">
          {/* Desktop RTL sidebar */}
          <aside className="sticky top-[72px] hidden h-[calc(100vh-96px)] w-64 shrink-0 flex-col overflow-y-auto rounded-2xl border border-slate-800/80 bg-sidebar scroll-slim md:flex">
            <div className="border-b border-slate-800/70 p-3">{sportSwitch}</div>
            {navList}
            <div className="mt-auto border-t border-slate-800/70 p-3">
              <div className="glass p-3">
                <div className="text-[10px] text-muted-foreground">موجودی بانک واحدی</div>
                <div className="num mt-1 text-xl font-bold text-emerald-300">
                  {state ? fmtUnits(state.metrics.bankroll, 0) : "—"} u
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {state ? `${state.metrics.wins} برد / ${state.metrics.losses} باخت` : "در حال بارگذاری…"}
                </div>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="min-w-0 flex-1">
            {isLoading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="shimmer h-28 rounded-xl" />
                ))}
              </div>
            ) : state ? (
              <>
                {view === "overview" && <OverviewView state={state} />}
                {view === "signals" && <SignalsHubView state={state} />}
                {view === "lab" && <QuantLabView state={state} />}
                {view === "ledger" && <VerifiedLedgerView state={state} />}
                {view === "telegram" && <TelegramStudioView state={state} />}
                {view === "billing" && <BillingApiView state={state} />}
              </>
            ) : null}

            {/* Sticky footer — pushed naturally by content, sticks on short pages */}
            <footer className="mt-auto pt-6 pb-2">
              <div className="glass flex flex-col items-center justify-between gap-2 p-3 text-[11px] text-muted-foreground sm:flex-row">
                <span>
                  NeoBet Quant Pro · هسته مالی SHA-256 · ضرایب واقعی 1xBet و BetForward
                  {state?.health.mode === "SIM" && (
                    <span className="mr-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">فید: SIM</span>
                  )}
                </span>
                <span className="num">
                  آخرین همگام‌سازی: {state?.health.lastIngest ? new Date(state.health.lastIngest).toLocaleTimeString("fa-IR") : "—"}
                  {todaySignals > 0 && ` · سیگنال امروز: ${todaySignals}`}
                </span>
              </div>
            </footer>
          </main>
        </div>

        {/* ===== Mobile bottom tab bar ===== */}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800/80 bg-[#060911F2] backdrop-blur-xl md:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label="ناوبری موبایل"
        >
          <div className="mx-auto grid max-w-lg grid-cols-5">
            {NAV.filter((n) => n.key !== "telegram").map((n) => {
              const Icon = n.icon;
              const active = view === n.key;
              return (
                <button
                  key={n.key}
                  onClick={() => setView(n.key)}
                  className={cn(
                    "flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] transition-colors",
                    active ? "text-emerald-300" : "text-slate-400",
                  )}
                >
                  <Icon className="size-5" />
                  {n.short}
                </button>
              );
            })}
          </div>
        </nav>

        <BetSlipDrawer />
      </div>
    </TooltipProvider>
  );
}
