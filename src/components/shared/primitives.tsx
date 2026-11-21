"use client";

/**
 * Shared UI primitives — v2.0 VIP 3D neon glass system.
 * SourceBadge carries the honest odds provenance labels:
 * 🟢 LIVE 1xBet REAL ODDS vs 🟡 MODEL FAIR PRICE (1xBet Margin 5.5%).
 */

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtPrice } from "@/lib/api-types";

/** Animated counting number — eases from the previous value to the next. */
export function AnimatedNumber({
  value, decimals = 0, prefix = "", suffix = "", className, flash = true,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  flash?: boolean;
}) {
  const [display, setDisplay] = useState(value);
  const [flashed, setFlashed] = useState(false);
  const prevRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = prevRef.current;
    const to = Number.isFinite(value) ? value : 0;
    prevRef.current = to;
    if (from === to) return;
    const t0 = performance.now();
    const DUR = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / DUR);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else if (flash) {
        setFlashed(true);
        window.setTimeout(() => setFlashed(false), 900);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, flash]);

  return (
    <span className={cn("num", flashed && "value-flash", className)}>
      {prefix}
      {display.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

/** Glass KPI tile with spotlight cursor border + animated value. */
export function KpiTile({
  label, value, decimals = 0, prefix = "", suffix = "", sub, tone = "cyan", icon,
}: {
  label: string;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  sub?: string;
  tone?: "cyan" | "emerald" | "violet" | "gold" | "red";
  icon?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
    el.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
  };
  const toneMap = {
    cyan: { text: "text-cyan-300", ring: "border-cyan-500/25", glow: "text-neon-cyan" },
    emerald: { text: "text-emerald-300", ring: "border-emerald-500/25", glow: "text-neon-emerald" },
    violet: { text: "text-violet-300", ring: "border-violet-500/25", glow: "text-neon-violet" },
    gold: { text: "text-amber-300", ring: "border-amber-500/25", glow: "text-neon-gold" },
    red: { text: "text-red-300", ring: "border-red-500/25", glow: "text-red-300" },
  }[tone];
  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={cn(
        "glass glass-hover spotlight-card spotlight-border p-4",
        toneMap.ring,
      )}
      data-testid="kpi-tile"
    >
      <div className="relative z-10">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{label}</span>
          {icon}
        </div>
        <AnimatedNumber
          value={value}
          decimals={decimals}
          prefix={prefix}
          suffix={suffix}
          className={cn("mt-2 block text-2xl font-extrabold tracking-tight", toneMap.text)}
        />
        {sub && <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

/** Honest odds provenance — never hides whether the price is LIVE or MODEL. */
export function SourceBadge({ source }: { source: string }) {
  if (source === "LIVE") {
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-300">
        🟢 LIVE 1xBet REAL ODDS
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-[10px] text-amber-300">
      🟡 MODEL FAIR PRICE (1xBet Margin 5.5%)
    </Badge>
  );
}

/** Neon team/player avatar — real ESPN logo with neon monogram fallback. */
export function TeamAvatar({
  name, logo, size = 36, className,
}: {
  name: string;
  logo?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return (
       
      <img
        src={logo}
        alt={`${name} logo`}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("rounded-lg object-contain drop-shadow-[0_0_10px_rgba(0,229,255,0.35)]", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const words = (name || "??").replace(/[^A-Za-z\s]/g, "").trim().split(/\s+/);
  const mono = words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : (words[0]?.slice(0, 2) ?? "??").toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-lg font-extrabold text-white", className)}
      style={{
        width: size, height: size,
        fontSize: Math.max(10, size * 0.34),
        background: `linear-gradient(140deg, hsl(${h} 70% 28%), hsl(${(h + 60) % 360} 70% 16%))`,
        border: `1px solid hsl(${h} 85% 55% / 0.6)`,
        boxShadow: `0 0 12px hsl(${h} 90% 55% / 0.35)`,
      }}
    >
      {mono}
    </span>
  );
}

export function PriceTag({ price, className }: { price: number; className?: string }) {
  return (
    <span className={cn("num rounded-lg border border-neon-emerald bg-emerald-500/10 px-2.5 py-1 text-sm font-bold text-emerald-300", className)}>
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
      className="num rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
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
