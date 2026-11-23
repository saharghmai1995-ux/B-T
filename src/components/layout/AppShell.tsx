"use client";

/**
 * AppShell — the v2.0 VIP web-app shell.
 * Desktop: collapsible RTL sidebar + sticky top command bar with a REAL live
 * clock. Mobile (<768px): glass bottom tab bar (PWA-like) with safe-area.
 * The paywall tier is gone: exclusive for the owner + verified VIP members.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore, type ViewKey } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/api-types";
import type { AppStatePayload } from "@/lib/api-types";
import { AnimatedNumber } from "@/components/shared/primitives";
import OverviewView from "@/components/views/OverviewView";
import SignalsHubView from "@/components/views/SignalsHubView";
import QuantLabView from "@/components/views/QuantLabView";
import VerifiedLedgerView from "@/components/views/VerifiedLedgerView";
import TelegramStudioView from "@/components/views/TelegramStudioView";
import {
  LayoutDashboard, Crosshair, FlaskConical, ShieldCheck, Radio,
  Search, RefreshCw, Menu, Clock,
} from "lucide-react";
import QuantumLogo from "@/components/layout/QuantumLogo";

// v3.1 SUPERAGENT nav naming — primary English label + secondary Persian line.
const NAV: Array<{ key: ViewKey; label: string; sub: string; short: string; icon: React.ElementType }> = [
  { key: "overview", label: "Overview", sub: "داشبورد عملکرد", short: "داشبورد", icon: LayoutDashboard },
  { key: "signals", label: "Predictions Hub", sub: "مرکز پیش‌بینی", short: "سیگنال‌ها", icon: Crosshair },
  { key: "ledger", label: "Hit-Rate Ledger", sub: "کارنامه سربه‌سر", short: "کارنامه", icon: ShieldCheck },
  { key: "lab", label: "Calibration Lab", sub: "آزمایشگاه سوپرایجنت", short: "آزمایشگاه", icon: FlaskConical },
  { key: "telegram", label: "Telegram Studio", sub: "استودیو تلگرام", short: "استودیو", icon: Radio },
  // v2.7 — the Settings & API-keys page is retired: keys live in the
  // git-ignored .env.local and channel config lives in the Telegram studio.
];

const SPORTS: Array<{ key: "all" | "football" | "tennis" | "basketball"; label: string }> = [
  { key: "all", label: "🌐 همه" },
  { key: "football", label: "⚽ فوتبال" },
  { key: "tennis", label: "🎾 تنیس" },
  { key: "basketball", label: "🏀 NBA" },
];

/** Real live system clock — fixes the frozen 00:00:00 footer bug. */
function LiveClock({ className }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(new Date()));
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(t);
    };
  }, []);
  return (
    <span className={cn("num inline-flex items-center gap-1.5", className)} suppressHydrationWarning>
      <Clock className="size-3 text-cyan-400" />
      {now ? fmtClock(now) : "--:--:--"}
    </span>
  );
}

export function useAppState() {
  return useQuery<AppStatePayload>({
    queryKey: ["app-state"],
    queryFn: async () => {
      const res = await fetch("/api/bootstrap");
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "bootstrap failed");
      return j.state as AppStatePayload;
    },
    // v2.5 warm dashboard — light polling keeps every view hot without
    // hammering the server: the server warm-engine does the heavy ingest.
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export default function AppShell() {
  // v3.2 Zero-Bankroll Purge — bet-slip store fields removed from the shell.
  const { view, sportFilter, setView, setSportFilter, searchQuery, setSearchQuery, syncing, setSyncing } = useAppStore();
  const qc = useQueryClient();
  const { data: state, isLoading, isError, error } = useAppState();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    if (isError) toast.error("بارگذاری ناموفق — دوباره تلاش کنید", { description: (error as Error)?.message });
  }, [isError, error]);

  const openCount = state?.openSignals.length ?? 0;
  const footballOpen = state?.openSignals.filter((s) => s.sport === "football").length ?? 0;
  const tennisOpen = state?.openSignals.filter((s) => s.sport === "tennis").length ?? 0;
  const basketballOpen = state?.openSignals.filter((s) => s.sport === "basketball").length ?? 0;

  /* v3.2 — Engine Health card values: PURE HIT-RATE only (bankroll/units purged). */
  const engineLab = state?.agentLab;
  const engineM = state?.metrics;
  const engineSettled = engineM ? engineM.wins + engineM.losses + engineM.voids : 0;
  const engineWinRate = engineLab ? engineLab.pureWinRate * 100 : (engineM?.winRate ?? 0);
  const engineNoLoss = engineLab
    ? engineLab.noLossRate * 100
    : engineSettled > 0 && engineM
      ? ((engineM.wins + engineM.voids) / engineSettled) * 100
      : 0;

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
                ? "border border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                : "border border-transparent text-slate-300 hover:bg-secondary hover:text-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1 text-right">
              <span className="block font-medium">{n.label}</span>
              <span className="block text-[10px] text-muted-foreground">{n.sub}</span>
            </span>
            {n.key === "signals" && openCount > 0 && (
              <Badge className="num bg-emerald-500 text-emerald-950 hover:bg-emerald-400 px-1.5 text-[10px]">
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
            sportFilter === s.key ? "bg-cyan-500/15 text-cyan-300" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  const feedLive = state?.health.mode !== "OFFLINE" && (state?.health.espn ?? false);

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
              <QuantumLogo size={34} />
              <span className="hidden text-sm font-extrabold tracking-tight sm:block">
                NeoBet <span className="neon-cyan">Quant Pro</span>
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

            {/* Feed health — honest LIVE vs OFFLINE (zero-mock: no SIM mode) */}
            {!online || state?.health.mode === "OFFLINE" ? (
              <div
                className="hidden items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 lg:flex"
                title="اتصال به فید زنده ESPN برقرار نیست — داده‌ای نمایش داده نمی‌شود"
              >
                <span className="size-2 rounded-full bg-red-500 text-red-500" />
                <span className="text-[11px] text-red-300">فید آفلاین — Zero-Mock</span>
              </div>
            ) : (
              <div className="hidden items-center gap-1.5 rounded-xl border border-slate-800 bg-secondary/50 px-2.5 py-1.5 lg:flex">
                <span className={cn("size-2 rounded-full", feedLive ? "pulse-dot bg-emerald-400 text-emerald-400" : "bg-red-500 text-red-500")} />
                <span className="text-[11px] text-muted-foreground">ESPN / 1xBet LIVE</span>
              </div>
            )}

            {/* VIP-only badge (paywall removed) */}
            <div className="hidden items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 sm:flex" title="وب‌اپ اختصاصی مدیر و اعضای VIP">
              <span className="text-[11px] font-bold text-amber-300">👑 VIP ONLY</span>
            </div>

            {/* Real live clock */}
            <div className="hidden items-center rounded-xl border border-slate-800 bg-secondary/50 px-2.5 py-1.5 md:flex">
              <LiveClock className="text-xs text-slate-300" />
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

            {/* v3.2 — LIVE consensus counter chip (bet-slip trigger purged) */}
            <button
              onClick={() => setView("signals")}
              className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 transition-colors hover:bg-emerald-500/20"
              title="مرکز پیش‌بینی — سیگنال‌های فعال"
              aria-label="سیگنال‌های فعال — مشاهده در مرکز پیش‌بینی"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
                <span className="num">
                  Active Picks: <span dir="ltr">{openCount}</span>
                </span>
              </span>
              <span className="num text-[9px] leading-3 text-emerald-400/80" dir="ltr">
                FB {footballOpen} · TN {tennisOpen} · NBA {basketballOpen}
              </span>
            </button>
          </div>
        </header>

        {/* ===== Body ===== */}
        <div className="mx-auto flex w-full max-w-[1500px] flex-1 gap-4 px-3 pb-24 pt-4 md:px-5 md:pb-6">
          {/* Desktop RTL sidebar */}
          <aside className="sticky top-[72px] hidden h-[calc(100vh-96px)] w-64 shrink-0 flex-col overflow-y-auto rounded-2xl border border-slate-800/80 bg-sidebar scroll-slim md:flex">
            <div className="border-b border-slate-800/70 p-3">{sportSwitch}</div>
            {navList}
            {/* v3.2 — Engine Health card: pure hit-rate (bankroll card purged) */}
            <div className="mt-auto border-t border-slate-800/70 p-3">
              <div className="glass p-3">
                <div className="text-[10px] text-muted-foreground">سلامت موتور</div>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">وین‌ریت خالص</span>
                    {state ? (
                      <AnimatedNumber
                        value={engineWinRate}
                        decimals={1}
                        suffix="%"
                        className="num text-sm font-extrabold text-emerald-300"
                      />
                    ) : (
                      <span className="num text-sm font-extrabold text-emerald-300" dir="ltr">—</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">نرخ بدون‌باخت</span>
                    {state ? (
                      <AnimatedNumber
                        value={engineNoLoss}
                        decimals={1}
                        suffix="%"
                        className="num text-sm font-extrabold text-cyan-300"
                      />
                    ) : (
                      <span className="num text-sm font-extrabold text-cyan-300" dir="ltr">—</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">Brier</span>
                    {state?.agentLab ? (
                      <AnimatedNumber
                        value={state.agentLab.brier}
                        decimals={3}
                        className="num text-sm font-extrabold text-violet-300"
                      />
                    ) : (
                      <span className="num text-sm font-extrabold text-violet-300" dir="ltr">—</span>
                    )}
                  </div>
                </div>
                <div className="num mt-2 text-[10px] text-muted-foreground" dir="ltr">
                  FB {footballOpen} + TN {tennisOpen} + NBA {basketballOpen}
                </div>
                <div className="mt-2 border-t border-slate-800/70 pt-2">
                  <LiveClock className="text-[11px] text-muted-foreground" />
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
              </>
            ) : null}

            {/* Sticky footer — pushed naturally by content, sticks on short pages */}
            <footer className="mt-auto pb-2 pt-6">
              <div className="glass flex flex-col items-center justify-between gap-2 p-3 text-[11px] text-muted-foreground sm:flex-row">
                <span className="flex items-center gap-2">
                  NeoBet Quant Pro v3.2 PURE HIT-RATE · پاک‌سازی کامل شاخص‌های واحدی از رابط کاربری · وین‌ریت خالص + نرخ بدون‌باخت + Brier · هسته تله‌متری SVG بدون WebGL · Zero-Mock
                </span>
                <span className="flex items-center gap-3">
                  <LiveClock className="text-cyan-300" />
                  <span className="num">
                    آخرین همگام‌سازی: {state?.health.lastIngest ? new Date(state.health.lastIngest).toLocaleTimeString("fa-IR") : "—"}
                    {todaySignals > 0 && ` · سیگنال امروز: ${todaySignals}`}
                  </span>
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
                    active ? "text-cyan-300" : "text-slate-400",
                  )}
                >
                  <Icon className="size-5" />
                  {n.short}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </TooltipProvider>
  );
}
