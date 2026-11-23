// src/components/QuantumTelemetryCore.tsx
"use client";

import React from "react";

export interface TelemetryCoreProps {
  footballScanned: number;
  tennisScanned: number;
  activeFootballPicks: number;
  activeTennisPicks: number;
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

export function QuantumTelemetryCore(props: TelemetryCoreProps) {
  const {
    footballScanned,
    tennisScanned,
    activeFootballPicks,
    activeTennisPicks,
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

  const totalScanned = footballScanned + tennisScanned;
  const totalActive = activeFootballPicks + activeTennisPicks;
  const coreColor = winRatePct >= 75 ? "#10b981" : winRatePct >= 60 ? "#06b6d4" : "#f59e0b";

  return (
    <div className="relative w-full rounded-2xl border border-cyan-500/20 bg-slate-950/80 p-5 backdrop-blur-xl overflow-hidden">
      {/* Header Telemetry Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_10px_#10b981]" />
          <span className="font-semibold text-slate-100">هسته زنده جریان داده سوپرایجنت‌ها</span>
        </div>
        <div dir="ltr" className="flex items-center gap-3 font-mono text-[11px] text-cyan-300">
          <span>ESPN LIVE: {totalScanned} matches (FB {footballScanned} · TN {tennisScanned})</span>
          <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-cyan-200">
            ACTIVE PICKS: {totalActive}
          </span>
        </div>
      </div>

      {/* Live Neural Flow Diagram (Zero-WebGL-Crash SVG with Animated Data Pulses) */}
      <div className="relative mx-auto w-full max-w-3xl">
        <svg viewBox="0 0 800 320" className="h-auto w-full select-none" role="img" aria-label="SuperAgent Live Data Flow">
          <defs>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={coreColor} stopOpacity="0.45" />
              <stop offset="65%" stopColor={coreColor} stopOpacity="0.12" />
              <stop offset="100%" stopColor={coreColor} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="pulseCyan" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.2" />
            </linearGradient>
          </defs>

          {/* Animated Flow Paths: Agents -> Central Consensus Core */}
          <path id="pathQuant" d="M 155 75 C 260 75, 300 135, 365 155" fill="none" stroke="url(#pulseCyan)" strokeWidth="2.5" strokeDasharray="6 6">
            <animate attributeName="stroke-dashoffset" from="48" to="0" dur="1.8s" repeatCount="indefinite" />
          </path>
          <path id="pathCoach" d="M 155 160 L 360 160" fill="none" stroke="#a855f7" strokeOpacity="0.7" strokeWidth="2.5" strokeDasharray="6 6">
            <animate attributeName="stroke-dashoffset" from="48" to="0" dur="2.1s" repeatCount="indefinite" />
          </path>
          <path id="pathMarket" d="M 155 245 C 260 245, 300 185, 365 165" fill="none" stroke="#38bdf8" strokeOpacity={wMarketPct > 0 ? 0.8 : 0.25} strokeWidth="2" strokeDasharray="4 6">
            <animate attributeName="stroke-dashoffset" from="40" to="0" dur="2.6s" repeatCount="indefinite" />
          </path>

          {/* Core -> Calibration Scientist & Shadow Veto Shield */}
          <path d="M 445 150 C 520 130, 560 90, 635 85" fill="none" stroke="#10b981" strokeOpacity="0.8" strokeWidth="2.5" strokeDasharray="6 6">
            <animate attributeName="stroke-dashoffset" from="48" to="0" dur="1.9s" repeatCount="indefinite" />
          </path>
          <path d="M 445 170 C 520 190, 560 230, 635 235" fill="none" stroke="#f59e0b" strokeOpacity="0.8" strokeWidth="2.5" strokeDasharray="6 6">
            <animate attributeName="stroke-dashoffset" from="48" to="0" dur="2.3s" repeatCount="indefinite" />
          </path>

          {/* Traveling Data Packets */}
          <circle r="4" fill="#22d3ee">
            <animateMotion dur="1.8s" repeatCount="indefinite" path="M 155 75 C 260 75, 300 135, 365 155" />
          </circle>
          <circle r="4" fill="#c084fc">
            <animateMotion dur="2.1s" repeatCount="indefinite" path="M 155 160 L 360 160" />
          </circle>
          <circle r="4" fill="#34d399">
            <animateMotion dur="1.9s" repeatCount="indefinite" path="M 445 150 C 520 130, 560 90, 635 85" />
          </circle>

          {/* Left Column: Parallel Input SuperAgents */}
          <g className="cursor-pointer" onClick={() => onNavigate("predictions")}>
            <rect x="15" y="42" width="145" height="66" rx="12" fill="#0f172a" stroke="#06b6d4" strokeOpacity="0.6" />
            <text x="87" y="68" textAnchor="middle" fill="#67e8f9" fontSize="11" fontWeight="700">SUPERAGENT 1</text>
            <text x="87" y="85" textAnchor="middle" fill="#e2e8f0" fontSize="10">Quant Data Analyst</text>
            <text x="87" y="100" textAnchor="middle" fill="#22d3ee" fontSize="10" fontFamily="monospace">Weight: {wQuantPct.toFixed(0)}%</text>
          </g>

          <g className="cursor-pointer" onClick={() => onNavigate("predictions")}>
            <rect x="15" y="127" width="145" height="66" rx="12" fill="#0f172a" stroke="#a855f7" strokeOpacity="0.6" />
            <text x="87" y="153" textAnchor="middle" fill="#d8b4fe" fontSize="11" fontWeight="700">SUPERAGENT 2</text>
            <text x="87" y="170" textAnchor="middle" fill="#e2e8f0" fontSize="10">Tactical Coach</text>
            <text x="87" y="185" textAnchor="middle" fill="#c084fc" fontSize="10" fontFamily="monospace">Weight: {wCoachPct.toFixed(0)}%</text>
          </g>

          <g>
            <rect x="15" y="212" width="145" height="66" rx="12" fill="#0f172a" stroke="#38bdf8" strokeOpacity={wMarketPct > 0 ? 0.6 : 0.25} />
            <text x="87" y="238" textAnchor="middle" fill="#7dd3fc" fontSize="11" fontWeight="700">SHARP PRIOR</text>
            <text x="87" y="255" textAnchor="middle" fill="#94a3b8" fontSize="10">Optional Market Sensor</text>
            <text x="87" y="270" textAnchor="middle" fill="#38bdf8" fontSize="10" fontFamily="monospace">
              {wMarketPct > 0 ? `Active: ${wMarketPct.toFixed(0)}%` : "Standby (0%)"}
            </text>
          </g>

          {/* Central Consensus Quantum Core */}
          <circle cx="405" cy="160" r="82" fill="url(#coreGlow)" />
          <circle cx="405" cy="160" r="58" fill="#020617" stroke={coreColor} strokeWidth="2.5" />
          <circle cx="405" cy="160" r="66" fill="none" stroke={coreColor} strokeOpacity="0.35" strokeDasharray="8 6">
            <animateTransform attributeName="transform" type="rotate" from="0 405 160" to="360 405 160" dur="18s" repeatCount="indefinite" />
          </circle>
          <text x="405" y="142" textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="600">NO-LOSS RATE</text>
          <text x="405" y="168" textAnchor="middle" fill="#f8fafc" fontSize="24" fontWeight="800" fontFamily="monospace">
            {noLossRatePct.toFixed(1)}%
          </text>
          <text x="405" y="186" textAnchor="middle" fill={coreColor} fontSize="10" fontFamily="monospace">
            WIN {winRatePct.toFixed(1)}%
          </text>

          {/* Right Column: Calibration Scientist & Shadow Veto Shield */}
          <g className="cursor-pointer" onClick={() => onNavigate("calibration")}>
            <rect x="635" y="52" width="150" height="72" rx="12" fill="#0f172a" stroke="#10b981" strokeOpacity="0.6" />
            <text x="710" y="76" textAnchor="middle" fill="#6ee7b7" fontSize="11" fontWeight="700">SUPERAGENT 3</text>
            <text x="710" y="93" textAnchor="middle" fill="#e2e8f0" fontSize="10">Calibration Scientist</text>
            <text x="710" y="110" textAnchor="middle" fill="#34d399" fontSize="10" fontFamily="monospace">
              Brier {brierScore.toFixed(3)} · ECE {ecePct.toFixed(1)}%
            </text>
          </g>

          <g className="cursor-pointer" onClick={() => onNavigate("ledger")}>
            <rect x="635" y="196" width="150" height="72" rx="12" fill="#0f172a" stroke="#f59e0b" strokeOpacity="0.6" />
            <text x="710" y="220" textAnchor="middle" fill="#fcd34d" fontSize="11" fontWeight="700">SHADOW SHIELD</text>
            <text x="710" y="237" textAnchor="middle" fill="#e2e8f0" fontSize="10">Vetoed Risk Matches</text>
            <text x="710" y="254" textAnchor="middle" fill="#fbbf24" fontSize="10" fontFamily="monospace">
              {shadowVetoCount} Vetoes · Lift {shadowLiftPp >= 0 ? "+" : ""}{shadowLiftPp.toFixed(1)}pp
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}

export default QuantumTelemetryCore;
