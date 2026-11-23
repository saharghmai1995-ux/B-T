"use client";

import React, { useMemo, useRef, useState } from "react";

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

/* v3.3.1 — deterministic starfield (image-inspired deep-space backdrop:
   cold blue stars + a few hot red embers, exactly like the reference art). */
interface Star { x: number; y: number; s: number; c: string; d: number; dur: number; }
const STAR_COLORS = ["#93c5fd", "#67e8f9", "#e2e8f0", "#fca5a5", "#7dd3fc"];
const STARFIELD: Star[] = Array.from({ length: 54 }, (_, i) => {
  // LCG — deterministic across SSR/CSR (no hydration mismatch).
  const r = (n: number) => ((Math.sin(i * 127.1 + n * 311.7) * 43758.5453) % 1 + 1) % 1;
  return {
    x: Math.round(r(1) * 1000) / 10,
    y: Math.round(r(2) * 1000) / 10,
    s: r(3) > 0.82 ? 2.5 : r(3) > 0.5 ? 2 : 1.2,
    c: STAR_COLORS[Math.floor(r(4) * STAR_COLORS.length)],
    d: Math.round(r(5) * 40) / 10,
    dur: 2.4 + Math.round(r(6) * 30) / 10,
  };
});

/** One tilted, spinning elliptical electron orbit (the atom-shell look). */
function ElectronOrbit({
  rotZ, dur, reverse, borderColor, glow, electronColor, electronSize,
}: {
  rotZ: number;
  dur: number;
  reverse?: boolean;
  borderColor: string;
  glow: string;
  electronColor: string;
  electronSize: string;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ transform: `rotateZ(${rotZ}deg) rotateX(74deg)`, transformStyle: "preserve-3d" }}
      aria-hidden
    >
      <div
        className={`absolute inset-0 rounded-full border-2 ${reverse ? "nq-orbit-rev" : "nq-orbit"}`}
        style={{
          borderColor,
          boxShadow: `0 0 18px ${glow}, inset 0 0 14px ${glow}`,
          animationDuration: `${dur}s`,
          animationTimingFunction: "linear",
          animationIterationCount: "infinite",
        }}
      >
        <span
          className="absolute left-1/2 top-0"
          style={{
            width: electronSize,
            height: electronSize,
            transform: "translate(-50%, -50%)",
            background: electronColor,
            boxShadow: `0 0 10px 2px ${electronColor}, 0 0 22px 6px ${electronColor}55`,
            borderRadius: "9999px",
          }}
        />
        <span
          className="absolute left-1/2 top-1/2 rounded-full opacity-80"
          style={{
            width: `calc(${electronSize} * 0.62)`,
            height: `calc(${electronSize} * 0.62)`,
            transform: `translate(-50%, -50%) rotate(${rotZ * 2}deg) translateY(calc(${electronSize} * -5.6))`,
            background: "#e2e8f0",
            boxShadow: `0 0 8px 1px ${electronColor}aa`,
          }}
        />
      </div>
    </div>
  );
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

  // Tilt is a DESKTOP-only flourish — touch pointers never set it, so mobile
  // keeps a perfectly stable, non-overflowing stage.
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ rx: -ny * 10, ry: nx * 12 });
  };

  const resetTilt = () => setTilt({ rx: 0, ry: 0 });

  const stars = useMemo(() => STARFIELD, []);

  const agentCard = (
    label: string,
    sub: string,
    value: string,
    color: string,
    border: string,
    onClick: () => void,
    hoverKey: string,
    dim = false,
  ) => (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHoveredNode(hoverKey)}
      onMouseLeave={() => setHoveredNode(null)}
      aria-label={`${label} — ${value}`}
      className={`w-full rounded-2xl border bg-slate-900/75 p-3 text-left backdrop-blur-md transition hover:scale-[1.02] ${border} ${dim ? "opacity-80" : ""}`}
    >
      <div dir="ltr" className="flex items-center justify-between text-[10px] font-bold md:text-[11px]" style={{ color }}>
        <span>{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <p dir="ltr" className="mt-1 text-[10px] text-slate-300 md:text-[11px]">{sub}</p>
    </button>
  );

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      className="relative w-full overflow-hidden rounded-3xl border border-cyan-500/25 bg-[radial-gradient(ellipse_at_center,rgba(30,64,175,0.20)_0%,rgba(2,6,23,0.97)_62%)] p-4 shadow-[0_0_60px_rgba(6,182,212,0.12)] md:p-5"
      style={{ perspective: "1200px" }}
    >
      {/* Deep-space starfield (v3.3.1 — image-inspired backdrop) */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {stars.map((st, i) => (
          <span
            key={i}
            className="absolute rounded-full nq-twinkle"
            style={{
              left: `${st.x}%`,
              top: `${st.y}%`,
              width: st.s,
              height: st.s,
              backgroundColor: st.c,
              boxShadow: `0 0 ${st.s * 3}px ${st.c}`,
              animationDelay: `${st.d}s`,
              animationDuration: `${st.dur}s`,
            }}
          />
        ))}
      </div>

      {/* Top Cinematic Telemetry Strip — wraps cleanly on 390px screens */}
      <div className="relative z-20 mb-4 flex flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="h-2.5 w-2.5 animate-ping rounded-full"
            style={{ backgroundColor: coreHex, boxShadow: `0 0 14px ${coreHex}` }}
          />
          <span className="font-bold tracking-wide text-slate-100">
            هسته کوانتومی سه‌بعدی جریان داده سوپرایجنت‌ها
          </span>
        </div>
        <div dir="ltr" className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] md:gap-2 md:text-[11px]">
          <span className="rounded-full border border-cyan-400/30 bg-cyan-950/60 px-2 py-0.5 text-cyan-200">
            LIVE SCAN: {totalScanned} (⚽ {footballScanned} · 🎾 {tennisScanned} · 🏀 {nbaScanned})
          </span>
          <span className="rounded-full border border-emerald-400/35 bg-emerald-950/60 px-2 py-0.5 text-emerald-300">
            ACTIVE PRE-MATCH: {totalActive}
          </span>
        </div>
      </div>

      {/* 3D Interactive Stage — vertical flow on mobile, horizontal on md+ */}
      <div
        className="relative mx-auto flex w-full max-w-4xl items-center justify-center transition-transform duration-200 ease-out"
        style={{
          transformStyle: "preserve-3d",
          transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
        }}
      >
        {/* ── Mobile vertical photon streams (agents top → core → outputs bottom) ── */}
        <svg
          viewBox="0 0 360 760"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full md:hidden"
          style={{ transform: "translateZ(-24px)" }}
          aria-hidden
        >
          <defs>
            <filter id="neonBloomM" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* Left stack → core */}
          <path d="M 80 96 C 90 170, 120 240, 168 300" fill="none" stroke="#22d3ee" strokeOpacity="0.5" strokeWidth="2" strokeDasharray="6 7">
            <animate attributeName="stroke-dashoffset" from="52" to="0" dur="1.7s" repeatCount="indefinite" />
          </path>
          <path d="M 180 268 L 180 306" fill="none" stroke="#c084fc" strokeOpacity="0.6" strokeWidth="2" strokeDasharray="5 6">
            <animate attributeName="stroke-dashoffset" from="44" to="0" dur="1.9s" repeatCount="indefinite" />
          </path>
          <path d="M 280 96 C 270 170, 240 240, 192 300" fill="none" stroke="#38bdf8" strokeOpacity={wMarketPct > 0 ? 0.65 : 0.2} strokeWidth="1.8" strokeDasharray="4 7">
            <animate attributeName="stroke-dashoffset" from="44" to="0" dur="2.3s" repeatCount="indefinite" />
          </path>
          {/* Core → right stack */}
          <path d="M 168 460 C 120 530, 96 610, 88 668" fill="none" stroke="#34d399" strokeOpacity="0.6" strokeWidth="2" strokeDasharray="6 7">
            <animate attributeName="stroke-dashoffset" from="52" to="0" dur="1.8s" repeatCount="indefinite" />
          </path>
          <path d="M 192 460 C 240 530, 264 610, 272 668" fill="none" stroke="#fbbf24" strokeOpacity="0.6" strokeWidth="2" strokeDasharray="6 7">
            <animate attributeName="stroke-dashoffset" from="52" to="0" dur="2.1s" repeatCount="indefinite" />
          </path>
          {/* Photons */}
          <circle r="3.6" fill="#22d3ee" filter="url(#neonBloomM)">
            <animateMotion dur="1.7s" repeatCount="indefinite" path="M 80 96 C 90 170, 120 240, 168 300" />
          </circle>
          <circle r="3.6" fill="#d8b4fe" filter="url(#neonBloomM)">
            <animateMotion dur="1.9s" repeatCount="indefinite" path="M 180 268 L 180 306" />
          </circle>
          <circle r="3.4" fill="#34d399" filter="url(#neonBloomM)">
            <animateMotion dur="1.8s" repeatCount="indefinite" path="M 168 460 C 120 530, 96 610, 88 668" />
          </circle>
          <circle r="3.2" fill="#fbbf24" filter="url(#neonBloomM)">
            <animateMotion dur="2.1s" repeatCount="indefinite" path="M 192 460 C 240 530, 264 610, 272 668" />
          </circle>
        </svg>

        {/* ── Desktop horizontal photon streams ── */}
        <svg
          viewBox="0 0 900 360"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 hidden h-full w-full md:block"
          style={{ transform: "translateZ(-20px)" }}
          aria-hidden
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
          <path d="M 190 84 C 310 84, 340 165, 408 172" fill="none" stroke="#22d3ee" strokeOpacity="0.55" strokeWidth="2.5" strokeDasharray="7 7">
            <animate attributeName="stroke-dashoffset" from="56" to="0" dur="1.6s" repeatCount="indefinite" />
          </path>
          <path d="M 190 180 L 402 180" fill="none" stroke="#c084fc" strokeOpacity="0.6" strokeWidth="2.5" strokeDasharray="7 7">
            <animate attributeName="stroke-dashoffset" from="56" to="0" dur="1.9s" repeatCount="indefinite" />
          </path>
          <path d="M 190 276 C 310 276, 340 195, 408 188" fill="none" stroke="#38bdf8" strokeOpacity={wMarketPct > 0 ? 0.65 : 0.22} strokeWidth="2" strokeDasharray="5 7">
            <animate attributeName="stroke-dashoffset" from="48" to="0" dur="2.4s" repeatCount="indefinite" />
          </path>
          {/* Core -> Right Outputs */}
          <path d="M 492 170 C 570 150, 612 105, 706 96" fill="none" stroke="#34d399" strokeOpacity="0.65" strokeWidth="2.5" strokeDasharray="7 7">
            <animate attributeName="stroke-dashoffset" from="56" to="0" dur="1.7s" repeatCount="indefinite" />
          </path>
          <path d="M 492 190 C 570 210, 612 255, 706 264" fill="none" stroke="#fbbf24" strokeOpacity="0.65" strokeWidth="2.5" strokeDasharray="7 7">
            <animate attributeName="stroke-dashoffset" from="56" to="0" dur="2.1s" repeatCount="indefinite" />
          </path>
          {/* Glowing Moving Data Photons */}
          <circle r="4.5" fill="#22d3ee" filter="url(#neonBloom)">
            <animateMotion dur="1.6s" repeatCount="indefinite" path="M 190 84 C 310 84, 340 165, 408 172" />
          </circle>
          <circle r="4.5" fill="#d8b4fe" filter="url(#neonBloom)">
            <animateMotion dur="1.9s" repeatCount="indefinite" path="M 190 180 L 402 180" />
          </circle>
          <circle r="4.5" fill="#34d399" filter="url(#neonBloom)">
            <animateMotion dur="1.7s" repeatCount="indefinite" path="M 492 170 C 570 150, 612 105, 706 96" />
          </circle>
          <circle r="4" fill="#fbbf24" filter="url(#neonBloom)">
            <animateMotion dur="2.1s" repeatCount="indefinite" path="M 492 190 C 570 210, 612 255, 706 264" />
          </circle>
        </svg>

        {/* Responsive Atomic Layout: agents / core / outputs */}
        <div className="relative z-10 grid w-full grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr] md:gap-4">
          {/* Left Satellite Agents */}
          <div className="flex flex-col gap-3" style={{ transform: "translateZ(26px)" }}>
            {agentCard(
              "SUPERAGENT 1 · QUANT",
              "Dixon-Coles · Markov · NBA NetRtg",
              `${wQuantPct.toFixed(0)}%`,
              "#67e8f9",
              "border-cyan-400/35 hover:border-cyan-300",
              () => onNavigate("predictions"),
              "quant",
            )}
            {agentCard(
              "SUPERAGENT 2 · COACH",
              "Tactics · B2B Fatigue · Injuries",
              `${wCoachPct.toFixed(0)}%`,
              "#c084fc",
              "border-purple-400/35 hover:border-purple-300",
              () => onNavigate("predictions"),
              "coach",
            )}
            <div className="rounded-2xl border border-sky-400/20 bg-slate-900/60 p-3 backdrop-blur-md">
              <div dir="ltr" className="flex items-center justify-between text-[10px] font-bold text-sky-300 md:text-[11px]">
                <span>SHARP MARKET PRIOR</span>
                <span className="font-mono">
                  {wMarketPct > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="size-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                      {`${wMarketPct.toFixed(0)}%`}
                    </span>
                  ) : (
                    "STANDBY"
                  )}
                </span>
              </div>
              <p dir="ltr" className="mt-1 text-[10px] text-slate-400 md:text-[11px]">
                {wMarketPct > 0 ? "ESPN Core — live de-vigged consensus" : "Optional Divergence & News Sensor"}
              </p>
            </div>
          </div>

          {/* Central Atomic Quantum Core (Z = 52px) — image-inspired:
              glowing hot nucleus inside 3 counter-rotating electron ellipses */}
          <div
            className="relative mx-auto flex h-60 w-60 items-center justify-center md:h-72 md:w-72"
            style={{ transform: "translateZ(52px)" }}
          >
            {/* Dashed orbital guide circle (geometry ring of the reference art) */}
            <div className="pointer-events-none absolute inset-1 rounded-full border border-dashed border-slate-500/25" aria-hidden />
            <div className="absolute inset-2" style={{ transformStyle: "preserve-3d" }} aria-hidden>
              <ElectronOrbit rotZ={0} dur={13} borderColor="#38bdf8aa" glow="rgba(56,189,248,0.28)" electronColor="#7dd3fc" electronSize="10px" />
              <ElectronOrbit rotZ={60} dur={17} reverse borderColor="#22d3ee99" glow="rgba(34,211,238,0.25)" electronColor="#67e8f9" electronSize="9px" />
              <ElectronOrbit rotZ={120} dur={21} borderColor="#93c5fd88" glow="rgba(147,197,253,0.22)" electronColor="#fca5a5" electronSize="8px" />
            </div>

            {/* Glass nucleus — hot core glow follows the live health colour */}
            <div
              className="relative z-10 flex h-36 w-36 flex-col items-center justify-center rounded-full border border-white/20 bg-slate-950/85 text-center backdrop-blur-xl nq-core-pulse md:h-40 md:w-40"
              style={{ boxShadow: `inset 0 0 30px ${coreHex}55, inset 0 -10px 26px ${coreHex}33, 0 0 52px ${coreHex}44` }}
            >
              <div
                className="nq-nucleus-breathe pointer-events-none absolute -inset-3 rounded-full"
                style={{ background: `radial-gradient(circle, ${coreHex}38 0%, transparent 66%)` }}
                aria-hidden
              />
              <div
                className="pointer-events-none absolute inset-2 rounded-full"
                style={{ background: `radial-gradient(circle at 50% 40%, #ffffff2e 0%, ${coreHex}2b 46%, transparent 72%)` }}
                aria-hidden
              />
              <span dir="ltr" className="relative text-[9px] font-semibold tracking-widest text-slate-400 md:text-[10px]">
                NO-LOSS RATE
              </span>
              <span dir="ltr" className="relative mt-0.5 font-mono text-2xl font-black text-white md:text-3xl">
                {noLossRatePct.toFixed(1)}%
              </span>
              <span dir="ltr" className="relative mt-1 font-mono text-[10px] font-bold md:text-[11px]" style={{ color: coreHex }}>
                WIN {winRatePct.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Right Satellite Outputs */}
          <div className="flex flex-col gap-3" style={{ transform: "translateZ(26px)" }}>
            {agentCard(
              "SUPERAGENT 3 · CALIBRATOR",
              `Brier ${brierScore.toFixed(3)} · Platt Auto-Tune`,
              `ECE ${ecePct.toFixed(1)}%`,
              "#34d399",
              "border-emerald-400/35 hover:border-emerald-300",
              () => onNavigate("calibration"),
              "calib",
            )}
            {agentCard(
              "SHADOW VETO SHIELD",
              `${shadowVetoCount} Vetoed Matches Audited`,
              `Lift ${shadowLiftPp >= 0 ? "+" : ""}${shadowLiftPp.toFixed(1)}pp`,
              "#fbbf24",
              "border-amber-400/35 hover:border-amber-300",
              () => onNavigate("ledger"),
              "shadow",
            )}
          </div>
        </div>
      </div>

      {/* Live Status Caption */}
      <div className="mt-2 min-h-[18px] text-center text-[11px] text-cyan-300" aria-live="polite">
        {hoveredNode === "quant" && "کلیک برای مشاهده پیش‌بینی‌های فعال موتور آماری (فوتبال + تنیس + NBA)"}
        {hoveredNode === "coach" && "کلیک برای مشاهده تحلیل تاکتیکی، خستگی و وتوهای سوپرایجنت مربی"}
        {hoveredNode === "calib" && "کلیک برای مشاهده آزمایشگاه کالیبراسیون و binهای قابلیت‌اعتماد"}
        {hoveredNode === "shadow" && "کلیک برای مشاهده دفتر سایه — وتوهای ممیزی‌شده با نتیجه واقعی"}
      </div>
    </div>
  );
}

export default CinematicQuantumCore3D;
