"use client";

import React, { useRef, useState } from "react";

export interface CinematicCore3DProps {
  footballScanned: number;
  tennisScanned: number;
  nbaScanned: number;
  activePicks: { football: number; tennis: number; nba: number };
  winRatePct: number;
  noLossRatePct: number;
  brierScore: number;
  ecePct: number;
  wQuantPct: number;
  wCoachPct: number;
  wMarketPct: number;
  shadowVetoCount: number;
  shadowLiftPp: number;
  onNavigate: (tab: "predictions" | "ledger" | "calibration") => void;
}

export function CinematicQuantumCore3D(props: CinematicCore3DProps) {
  const {
    footballScanned,
    tennisScanned,
    nbaScanned,
    activePicks,
    winRatePct,
    noLossRatePct,
    brierScore,
    ecePct,
    wQuantPct,
    wCoachPct,
    wMarketPct,
    shadowVetoCount,
    shadowLiftPp,
    onNavigate,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const totalScanned = footballScanned + tennisScanned + nbaScanned;
  const totalActive = activePicks.football + activePicks.tennis + activePicks.nba;
  const coreHex = noLossRatePct >= 80 ? "#10b981" : noLossRatePct >= 68 ? "#06b6d4" : "#f59e0b";

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ rx: -ny * 14, ry: nx * 16 });
  };

  const resetTilt = () => setTilt({ rx: 0, ry: 0 });

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      className="relative w-full overflow-hidden rounded-3xl border border-cyan-500/25 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,0.14)_0%,rgba(2,6,23,0.96)_68%)] p-5 shadow-[0_0_60px_rgba(6,182,212,0.12)]"
      style={{ perspective: "1200px" }}
    >
      {/* Top Cinematic Telemetry Strip */}
      <div className="relative z-20 mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2.5">
          <span
            className="h-2.5 w-2.5 animate-ping rounded-full"
            style={{ backgroundColor: coreHex, boxShadow: `0 0 14px ${coreHex}` }}
          />
          <span className="font-bold tracking-wide text-slate-100">
            هسته کوانتومی سه‌بعدی جریان داده سوپرایجنت‌ها
          </span>
        </div>
        <div dir="ltr" className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="rounded-full border border-cyan-400/30 bg-cyan-950/60 px-2.5 py-0.5 text-cyan-200">
            LIVE SCAN: {totalScanned} (⚽ {footballScanned} · 🎾 {tennisScanned} · 🏀 {nbaScanned})
          </span>
          <span className="rounded-full border border-emerald-400/35 bg-emerald-950/60 px-2.5 py-0.5 text-emerald-300">
            ACTIVE PRE-MATCH: {totalActive}
          </span>
        </div>
      </div>

      {/* 3D Interactive Stage */}
      <div
        className="relative mx-auto flex min-h-[340px] w-full max-w-4xl items-center justify-center transition-transform duration-200 ease-out"
        style={{
          transformStyle: "preserve-3d",
          transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
        }}
      >
        {/* Background Volumetric Neon Particle Streams (SVG Layer at Z = -20px) */}
        <svg
          viewBox="0 0 900 340"
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ transform: "translateZ(-20px)" }}
        >
          <defs>
            <filter id="neonBloom" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Left Agents -> Core */}
          <path d="M 190 78 C 310 78, 340 155, 420 170" fill="none" stroke="#22d3ee" strokeOpacity="0.55" strokeWidth="2.5" strokeDasharray="7 7">
            <animate attributeName="stroke-dashoffset" from="56" to="0" dur="1.6s" repeatCount="indefinite" />
          </path>
          <path d="M 190 170 L 415 170" fill="none" stroke="#c084fc" strokeOpacity="0.6" strokeWidth="2.5" strokeDasharray="7 7">
            <animate attributeName="stroke-dashoffset" from="56" to="0" dur="1.9s" repeatCount="indefinite" />
          </path>
          <path d="M 190 262 C 310 262, 340 185, 420 170" fill="none" stroke="#38bdf8" strokeOpacity={wMarketPct > 0 ? 0.65 : 0.22} strokeWidth="2" strokeDasharray="5 7">
            <animate attributeName="stroke-dashoffset" from="48" to="0" dur="2.4s" repeatCount="indefinite" />
          </path>

          {/* Core -> Right Outputs */}
          <path d="M 480 160 C 565 140, 610 95, 705 90" fill="none" stroke="#34d399" strokeOpacity="0.65" strokeWidth="2.5" strokeDasharray="7 7">
            <animate attributeName="stroke-dashoffset" from="56" to="0" dur="1.7s" repeatCount="indefinite" />
          </path>
          <path d="M 480 180 C 565 200, 610 245, 705 250" fill="none" stroke="#fbbf24" strokeOpacity="0.65" strokeWidth="2.5" strokeDasharray="7 7">
            <animate attributeName="stroke-dashoffset" from="56" to="0" dur="2.1s" repeatCount="indefinite" />
          </path>

          {/* Glowing Moving Data Photons */}
          <circle r="4.5" fill="#22d3ee" filter="url(#neonBloom)">
            <animateMotion dur="1.6s" repeatCount="indefinite" path="M 190 78 C 310 78, 340 155, 420 170" />
          </circle>
          <circle r="4.5" fill="#d8b4fe" filter="url(#neonBloom)">
            <animateMotion dur="1.9s" repeatCount="indefinite" path="M 190 170 L 415 170" />
          </circle>
          <circle r="4.5" fill="#34d399" filter="url(#neonBloom)">
            <animateMotion dur="1.7s" repeatCount="indefinite" path="M 480 160 C 565 140, 610 95, 705 90" />
          </circle>
          <circle r="4" fill="#fbbf24" filter="url(#neonBloom)">
            <animateMotion dur="2.1s" repeatCount="indefinite" path="M 480 180 C 565 200, 610 245, 705 250" />
          </circle>
        </svg>

        {/* Responsive 3-Column 3D Glass Layout (Elevated in Z-Space) */}
        <div className="relative z-10 grid w-full grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
          {/* Left Satellite Agents */}
          <div className="flex flex-col gap-3" style={{ transform: "translateZ(26px)" }}>
            <button
              type="button"
              onClick={() => onNavigate("predictions")}
              onMouseEnter={() => setHoveredNode("quant")}
              onMouseLeave={() => setHoveredNode(null)}
              className="rounded-2xl border border-cyan-400/35 bg-slate-900/75 p-3 text-left backdrop-blur-md transition hover:scale-[1.03] hover:border-cyan-300"
            >
              <div dir="ltr" className="flex items-center justify-between text-[11px] font-bold text-cyan-300">
                <span>SUPERAGENT 1 · QUANT</span>
                <span className="font-mono">{wQuantPct.toFixed(0)}%</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-300">Dixon-Coles · Markov · NBA NetRtg</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate("predictions")}
              onMouseEnter={() => setHoveredNode("coach")}
              onMouseLeave={() => setHoveredNode(null)}
              className="rounded-2xl border border-purple-400/35 bg-slate-900/75 p-3 text-left backdrop-blur-md transition hover:scale-[1.03] hover:border-purple-300"
            >
              <div dir="ltr" className="flex items-center justify-between text-[11px] font-bold text-purple-300">
                <span>SUPERAGENT 2 · COACH</span>
                <span className="font-mono">{wCoachPct.toFixed(0)}%</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-300">Tactics · B2B Fatigue · Injuries</p>
            </button>

            <div className="rounded-2xl border border-sky-400/20 bg-slate-900/60 p-3 text-left backdrop-blur-md">
              <div dir="ltr" className="flex items-center justify-between text-[11px] font-bold text-sky-300">
                <span>SHARP MARKET PRIOR</span>
                <span className="font-mono">{wMarketPct > 0 ? `${wMarketPct.toFixed(0)}%` : "STANDBY"}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Optional Divergence & News Sensor</p>
            </div>
          </div>

          {/* Central Rotating 3D Holographic Core (Z = 52px) */}
          <div
            className="relative mx-auto flex h-48 w-48 items-center justify-center"
            style={{ transform: "translateZ(52px)" }}
          >
            {/* Outer Orbital Ring 1 */}
            <div
              className="absolute inset-0 animate-[spin_14s_linear_infinite] rounded-full border-2 border-dashed opacity-55"
              style={{ borderColor: coreHex }}
            />
            {/* Inner Counter-Rotating Ring 2 */}
            <div
              className="absolute inset-3 animate-[spin_9s_linear_infinite_reverse] rounded-full border border-cyan-400/50 shadow-[0_0_30px_rgba(34,211,238,0.28)]"
            />
            {/* Glass Core Sphere */}
            <div
              className="relative flex h-36 w-36 flex-col items-center justify-center rounded-full border border-white/15 bg-slate-950/90 text-center backdrop-blur-xl"
              style={{ boxShadow: `inset 0 0 28px ${coreHex}44, 0 0 42px ${coreHex}33` }}
            >
              <span dir="ltr" className="text-[10px] font-semibold tracking-widest text-slate-400">
                NO-LOSS RATE
              </span>
              <span dir="ltr" className="mt-0.5 font-mono text-3xl font-black text-white">
                {noLossRatePct.toFixed(1)}%
              </span>
              <span dir="ltr" className="mt-1 font-mono text-[11px] font-bold" style={{ color: coreHex }}>
                WIN {winRatePct.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Right Satellite Outputs */}
          <div className="flex flex-col gap-3" style={{ transform: "translateZ(26px)" }}>
            <button
              type="button"
              onClick={() => onNavigate("calibration")}
              className="rounded-2xl border border-emerald-400/35 bg-slate-900/75 p-3 text-left backdrop-blur-md transition hover:scale-[1.03] hover:border-emerald-300"
            >
              <div dir="ltr" className="flex items-center justify-between text-[11px] font-bold text-emerald-300">
                <span>SUPERAGENT 3 · CALIBRATOR</span>
                <span className="font-mono">ECE {ecePct.toFixed(1)}%</span>
              </div>
              <p dir="ltr" className="mt-1 font-mono text-[11px] text-slate-300">
                Brier {brierScore.toFixed(3)} · Platt Auto-Tune
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate("ledger")}
              className="rounded-2xl border border-amber-400/35 bg-slate-900/75 p-3 text-left backdrop-blur-md transition hover:scale-[1.03] hover:border-amber-300"
            >
              <div dir="ltr" className="flex items-center justify-between text-[11px] font-bold text-amber-300">
                <span>SHADOW VETO SHIELD</span>
                <span className="font-mono">
                  Lift {shadowLiftPp >= 0 ? "+" : ""}
                  {shadowLiftPp.toFixed(1)}pp
                </span>
              </div>
              <p dir="ltr" className="mt-1 font-mono text-[11px] text-slate-300">
                {shadowVetoCount} Vetoed Matches Audited
              </p>
            </button>
          </div>
        </div>
      </div>

      {/* Live Status Caption */}
      {hoveredNode && (
        <div className="mt-2 text-center text-[11px] text-cyan-300">
          {hoveredNode === "quant"
            ? "کلیک برای مشاهده پیش‌بینی‌های فعال موتور آماری (فوتبال + تنیس + NBA)"
            : "کلیک برای مشاهده تحلیل تاکتیکی، خستگی و وتوهای سوپرایجنت مربی"}
        </div>
      )}
    </div>
  );
}

export default CinematicQuantumCore3D;
