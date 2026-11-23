"use client";

/**
 * HeroQuantum3D — v3.1 Overview hero: the "quantum superagent core".
 *
 * Design (Obsidian Carbon):
 *  - Central emerald (#34D399) wireframe icosahedron nucleus, slowly rotating,
 *    with a dark inner solid shell + soft halo so the back wires read as depth.
 *  - Three neon orbit rings at tilted axes — cyan #00E5FF, violet #8B5CF6,
 *    gold #F59E0B — each precessing like a gyroscope, with a glowing satellite
 *    dot travelling along the ring.
 *  - ~120 drifting additive-blend particles in a flattened shell around the core.
 *
 * Safety rails:
 *  - SSR: the Canvas is created ONLY after mount (useEffect + useState), so the
 *    server render is a styled static shell — zero `window` access during SSR.
 *  - prefers-reduced-motion: when matched, frameloop = "demand" (one static
 *    frame) and every useFrame animation is skipped.
 *  - Document visibility: `visibilitychange` flips frameloop to "never" while
 *    the tab is hidden, so the GPU never burns cycles off-screen.
 *  - Performance: dpr capped at [1, 1.5], basic materials only (no lights),
 *    ~120 points + 3 low-poly tori — total vertex count is modest.
 *  - Runtime failures are caught by <ErrorBoundary3D> in the parent view.
 */

import { useMemo, useRef, useSyncExternalStore } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";

const EMERALD = "#34D399";
const CYAN = "#00E5FF";
const VIOLET = "#8B5CF6";
const GOLD = "#F59E0B";

/* ------------------------------ 3D scene pieces ------------------------------ */

/** Emerald wireframe icosahedron core with dark nucleus + halo. */
function QuantumCore({ animate }: { animate: boolean }) {
  const shell = useRef<THREE.Mesh>(null);
  const nucleus = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (!animate) return;
    if (shell.current) {
      shell.current.rotation.y += delta * 0.22;
      shell.current.rotation.x += delta * 0.08;
    }
    if (nucleus.current) {
      nucleus.current.rotation.y -= delta * 0.14;
      nucleus.current.rotation.z += delta * 0.05;
    }
  });

  return (
    <Float speed={1.3} rotationIntensity={0.22} floatIntensity={0.5}>
      {/* soft halo (backside sphere) */}
      <mesh scale={2.1}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshBasicMaterial color={EMERALD} transparent opacity={0.05} side={THREE.BackSide} depthWrite={false} />
      </mesh>
      {/* dark solid nucleus — occludes far-side wires for depth */}
      <mesh ref={nucleus}>
        <icosahedronGeometry args={[0.94, 1]} />
        <meshBasicMaterial color="#071A12" transparent opacity={0.94} />
      </mesh>
      {/* emerald wireframe shell */}
      <mesh ref={shell}>
        <icosahedronGeometry args={[1.52, 0]} />
        <meshBasicMaterial color={EMERALD} wireframe transparent opacity={0.88} />
      </mesh>
    </Float>
  );
}

/** One neon orbit ring: tilted torus + glowing satellite dot, precessing. */
function NeonRing({
  radius,
  color,
  tilt,
  precessSpeed,
  satSpeed,
  phase,
  animate,
}: {
  radius: number;
  color: string;
  tilt: [number, number, number];
  precessSpeed: number;
  satSpeed: number;
  phase: number;
  animate: boolean;
}) {
  const precess = useRef<THREE.Group>(null);
  const satellite = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    if (precess.current) precess.current.rotation.y = t * precessSpeed;
    if (satellite.current) {
      const a = t * satSpeed + phase;
      satellite.current.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    }
  });

  return (
    <group ref={precess}>
      <group rotation={tilt}>
        <mesh>
          <torusGeometry args={[radius, 0.014, 8, 80]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} />
        </mesh>
        <mesh ref={satellite} position={[radius, 0, 0]}>
          <sphereGeometry args={[0.05, 10, 10]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    </group>
  );
}

/** ~120 drifting additive particles in a flattened shell around the core. */
function DriftParticles({ count = 120, animate }: { count?: number; animate: boolean }) {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [new THREE.Color(EMERALD), new THREE.Color(CYAN), new THREE.Color(VIOLET), new THREE.Color(GOLD)];
    for (let i = 0; i < count; i += 1) {
      // spherical shell r = 2.4..4.6, slightly flattened on Y for a galaxy feel
      const r = 2.4 + Math.random() * 2.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * 0.72;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const c = palette[i % palette.length];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return { positions, colors };
  }, [count]);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    if (ref.current) {
      ref.current.rotation.y = t * 0.045;
      ref.current.position.y = Math.sin(t * 0.32) * 0.14;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        vertexColors
        sizeAttenuation
        transparent
        opacity={0.8}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Scene({ animate }: { animate: boolean }) {
  return (
    <>
      <QuantumCore animate={animate} />
      <NeonRing radius={2.35} color={CYAN} tilt={[1.15, 0.2, 0]} precessSpeed={0.12} satSpeed={0.7} phase={0} animate={animate} />
      <NeonRing radius={2.8} color={VIOLET} tilt={[0.6, -0.5, 0.35]} precessSpeed={-0.09} satSpeed={-0.55} phase={2.1} animate={animate} />
      <NeonRing radius={3.3} color={GOLD} tilt={[1.45, 0.35, -0.2]} precessSpeed={0.07} satSpeed={0.45} phase={4.2} animate={animate} />
      <DriftParticles count={120} animate={animate} />
    </>
  );
}

/* --------------------- client-only flags (SSR-safe, lint-safe) ---------------------
 * All three flags use useSyncExternalStore: the server snapshot renders the
 * static shell, the client snapshot flips right after hydration — no setState
 * inside effects, no hydration mismatch.
 */

/** Hydration flag: false on the server, true on every client render. */
const subscribeHydrated = () => () => {};
const getHydratedClient = () => true;
const getHydratedServer = () => false;

/** Lazy client-side singleton for the reduced-motion media query. */
let reducedMql: MediaQueryList | null = null;
const getReducedMql = (): MediaQueryList => {
  if (!reducedMql) reducedMql = window.matchMedia("(prefers-reduced-motion: reduce)");
  return reducedMql;
};
const subscribeReduced = (cb: () => void) => {
  const mq = getReducedMql();
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const getReducedClient = () => getReducedMql().matches;
const getReducedServer = () => false;

/** Document visibility — pause the render loop whenever the tab is hidden. */
const subscribeVisible = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
const getVisibleClient = () => !document.hidden;
const getVisibleServer = () => true;

/* --------------------------------- hero shell --------------------------------- */

const LEGEND: Array<{ label: string; color: string }> = [
  { label: "QUANT", color: EMERALD },
  { label: "COACH", color: CYAN },
  { label: "SHARP-PRIOR", color: VIOLET },
  { label: "CONSENSUS", color: GOLD },
];

export default function HeroQuantum3D() {
  // SSR safety: Canvas mounts only after hydration (client snapshot flips true).
  const mounted = useSyncExternalStore(subscribeHydrated, getHydratedClient, getHydratedServer);
  // prefers-reduced-motion → render one static frame, skip all animation.
  const reduced = useSyncExternalStore(subscribeReduced, getReducedClient, getReducedServer);
  // Pause the render loop whenever the tab is hidden (battery/GPU friendly).
  const visible = useSyncExternalStore(subscribeVisible, getVisibleClient, getVisibleServer);

  const animate = !reduced && visible;
  const frameloop: "always" | "demand" | "never" = reduced ? "demand" : visible ? "always" : "never";

  return (
    <div
      className="relative h-[260px] overflow-hidden rounded-2xl border border-slate-800/80 bg-[#050810] md:h-[340px]"
      role="img"
      aria-label="موتور سوپرایجنت موازی — هسته کوانتومی سه‌بعدی"
      data-testid="overview-hero-3d"
    >
      {/* Canvas mounts client-side only — SSR renders the styled shell below */}
      {mounted && (
        <Canvas
          className="absolute inset-0"
          dpr={[1, 1.5]}
          frameloop={frameloop}
          camera={{ position: [0, 0.5, 6.6], fov: 40 }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        >
          <Scene animate={animate} />
        </Canvas>
      )}

      {/* gradient blend into the terminal background (#050810) */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(5,8,16,0.38)_55%,rgba(5,8,16,0.92)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#050810] to-transparent" />

      {/* overlay HTML — title + subtitle (English mono, RTL-safe) + legend */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-4 md:p-5" dir="ltr">
        <div className="text-center">
          <h2
            className="text-[11px] font-bold tracking-[0.35em] text-emerald-300 md:text-xs"
            style={{ fontFamily: "var(--font-jetbrains), ui-monospace, monospace", textShadow: "0 0 14px rgba(52,211,153,0.55)" }}
          >
            PARALLEL SUPERAGENT ENGINE
          </h2>
          <p
            className="mt-1.5 text-[9px] tracking-[0.14em] text-slate-400 md:text-[10px]"
            style={{ fontFamily: "var(--font-jetbrains), ui-monospace, monospace" }}
          >
            Quant × Coach × Sharp-Prior — Parallel Consensus v3.1
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {LEGEND.map((l) => (
            <span
              key={l.label}
              className="flex items-center gap-1.5 text-[8px] tracking-[0.2em] text-slate-500 md:text-[9px]"
              style={{ fontFamily: "var(--font-jetbrains), ui-monospace, monospace" }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: l.color, boxShadow: `0 0 8px ${l.color}` }}
              />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
