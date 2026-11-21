"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtPrice } from "@/lib/api-types";

export function StatTile({
  label, value, sub, accent = "emerald", icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "emerald" | "gold" | "red" | "slate";
  icon?: React.ReactNode;
}) {
  const ring = {
    emerald: "border-emerald-500/25 bg-emerald-500/5",
    gold: "border-amber-400/25 bg-amber-400/5",
    red: "border-red-500/25 bg-red-500/5",
    slate: "border-slate-600/30 bg-slate-500/5",
  }[accent];
  return (
    <div className={cn("glass glass-hover p-4", ring)} data-testid="stat-tile">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="num mt-2 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function SourceBadge({ source }: { source: string }) {
  if (source === "ESTIMATE") {
    return (
      <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-amber-300 text-[10px]">
        1xBet MARKET ESTIMATE
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[10px]">
      LIVE 1xBet FEED
    </Badge>
  );
}

export function PriceTag({ price, className }: { price: number; className?: string }) {
  return (
    <span className={cn("num rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-sm font-bold text-emerald-300", className)}>
      {fmtPrice(price)}
    </span>
  );
}

export function SportIcon({ sport, className }: { sport: string; className?: string }) {
  return <span className={className}>{sport === "tennis" ? "🎾" : "⚽"}</span>;
}

export function HashChip({ hash, onClick }: { hash: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="num rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-400 hover:border-emerald-500/50 hover:text-emerald-300 transition-colors"
      title={hash}
    >
      SHA-256 {hash.slice(0, 10)}…
    </button>
  );
}

export function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="glass flex flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="font-semibold">{title}</div>
      {sub && <div className="max-w-md text-xs leading-6 text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="shimmer h-28 rounded-xl" />
      ))}
    </div>
  );
}
