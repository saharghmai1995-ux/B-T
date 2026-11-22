"use client";

/**
 * QuantumLogo (v2.7) — the system mark as logo motion: a glowing quant
 * nucleus with a football ball and a tennis ball orbiting it in opposite
 * directions, each ball flickering through uncertain positions (quantum
 * movement). Pure CSS — zero dependencies, reduced-motion safe.
 */

export default function QuantumLogo({ size = 34 }: { size?: number }) {
  return (
    <span
      className="qp-root"
      style={{ width: size, height: size }}
      role="img"
      aria-label="NeoBet Quant Pro — لوگوی متحرک کوانتومی با توپ فوتبال و تنیس"
    >
      <span className="qp-core" />
      <span className="qp-ring" />
      <span className="qp-orbit">
        <span className="qp-ball" style={{ left: "50%", top: -4, marginLeft: -6 }}>
          ⚽
        </span>
      </span>
      <span className="qp-orbit-rev">
        <span className="qp-ball qp-ball-b" style={{ left: "50%", bottom: -4, marginLeft: -5 }}>
          🎾
        </span>
      </span>
    </span>
  );
}
