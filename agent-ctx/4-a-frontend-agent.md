# Task 4-a — Overview Tab Rebuild + R3F 3D Hero (NeoBet Quant Pro v3.1)

Agent: frontend (task 4-a) · Status: COMPLETE · Date: 2026-11-23

## Files created / modified

| File | Action | Lines |
|---|---|---|
| `src/components/three/ErrorBoundary3D.tsx` | NEW | 86 |
| `src/components/three/HeroQuantum3D.tsx` | NEW | 299 |
| `src/components/views/OverviewView.tsx` | FULL REBUILD | 807 |
| `src/components/layout/AppShell.tsx` | Minimal diff (NAV labels + version badge only) | 363 |

## 1. ErrorBoundary3D (NEW)

- React class boundary `ErrorBoundary3D` (named + default export), `getDerivedStateFromError` + `componentDidCatch` (console-only telemetry).
- Fallback: glass neon violet card on `#050810`, min-h 260px/340px (matches hero), exact Persian text **"رندر سه‌بعدی موقتاً غیرفعال است"**, truncated error message chip (dir="ltr"), "تلاش دوباره" retry button that resets state.

## 2. HeroQuantum3D (NEW)

Scene: emerald `#34D399` wireframe icosahedron core (slow rotate, drei `Float` bob) + dark inner nucleus + BackSide halo; 3 tilted neon torus rings — cyan `#00E5FF` / violet `#8B5CF6` / gold `#F59E0B` — each precessing with an orbiting satellite dot; 120 additive-blend vertex-colored particles in a flattened shell. MeshBasicMaterial only (zero lights), `dpr={[1, 1.5]}`, modest vertex count.

Guards:
- **SSR**: Canvas rendered only after hydration via `useSyncExternalStore` (server snapshot false → client true). No `window` access during SSR; pre-mount shows styled static shell (gradient + overlay text), no flash.
- **prefers-reduced-motion**: `frameloop="demand"` (single static frame) + all `useFrame` animations short-circuit via `animate=false`.
- **Visibility pause**: `visibilitychange` → `frameloop="never"` when hidden, `"always"` when visible.
- **ErrorBoundary**: parent (OverviewView) wraps it in `<ErrorBoundary3D>`.
- Used `useSyncExternalStore` instead of setState-in-effect because the new `react-hooks/set-state-in-effect` ESLint rule (React 19) rejects the classic mounted-flag effect.

Shell: `h-[260px] md:h-[340px]` (260 mobile / 340 desktop), rounded-2xl, border slate-800, bg `#050810`, radial + bottom gradient overlays blending into the page background. Overlay HTML (pointer-events-none, dir="ltr", JetBrains mono via `var(--font-jetbrains)`): small-caps title **"PARALLEL SUPERAGENT ENGINE"**, subtitle **"Quant × Coach × Sharp-Prior — Parallel Consensus v3.1"**, plus a 4-dot legend (QUANT/COACH/SHARP-PRIOR/CONSENSUS). `role="img"` + Persian aria-label, `data-testid="overview-hero-3d"`.

## 3. OverviewView v3.1 (FULL REBUILD)

Modules in order (root `data-testid="overview-view"`):
1. **Hero**: `<ErrorBoundary3D><HeroQuantum3D /></ErrorBoundary3D>` inside relative section.
2. **4 v3.1 KPI cards** (`data-testid="overview-kpis"`, grid-cols-1 → sm:2 → xl:4, custom `V31Kpi` glass spotlight cards p-4, AnimatedNumber headlines, "—" dash placeholder when agentLab absent):
   - Pure Win Rate — `agentLab.pureWinRate*100` else `metrics.winRate` (emerald, Target icon).
   - No-Loss Rate (Shield) — `agentLab.noLossRate*100` else fallback `((wins+voids)/(wins+losses+voids))*100`, else `metrics.winRate` when settled=0 (cyan, ShieldCheck).
   - Calibration — `agentLab.brier` (3 decimals) + sub `ECE ${(ece*100).toFixed(1)}%`; dash card "کالیبراسیون هنوز اجرا نشده" if absent (violet, Gauge).
   - Win Streak — `agentLab.winStreak` + sub `Shadow Lift ${shadow.shadowLiftPct.toFixed(1)}pp`; dash card if absent (gold, Flame).
3. **Sport split panel** (`overview-sport-split`): Football/Tennis glass cards — WON / پوش(VOID) / LOST counts (voids computed as `settled − wins − losses`, clamped ≥0), Win Rate % + No-Loss Rate % (AnimatedNumber), settled count chip.
4. **Pick of the Day** (`overview-pick`): today key computed INLINE via `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" })` (no server import; guards invalid/pre-2020 dates). Filters `openSignals` by `s.dayKey === todayKey || tehranDayKey(s.startTime) === todayKey`; ranking: SHIELD=0 → SINGLE_EV=1 → others=2, then `(noLossProb ?? modelProb)` desc. Card: matchInfo + TeamBlocks, league, kickoff `fmtDateTimeFa` (dir="ltr" num), TierBadge + ShieldBadge + NoLossChip, officialBetLine + marketFa, consensus % (violet chip, "—" fallback), PriceTag, +EV badge, stake, HashChip, "مشاهده در مرکز پیش‌بینی" button (setSportFilter+setView). Empty → **transparent dashed card**: "امروز مسابقه‌ای برای انتخاب طلایی وجود ندارد" — NEVER leaks tomorrow's match.
5. **Equity curve + daily PnL** (`overview-charts`): kept verbatim from v2.x (range 7/30/all filter, glowing Areas emerald/violet + cyan total line, PnL bars + gradient zero ReferenceLine, EmptyState guards).
6. **Interactive settlements** (`overview-settlements`): latest **8** rows, `max-h-[560px] overflow-y-auto scroll-slim`, chevron rotate. Expanded audit panel: Quant view (modelProb %, noLossProb % or "—"), Coach view (consensusPct or "—" + static tactical note in violet box), Sharp sensor (`sharpSource ?? "بازار در دسترس نبود — وزن صفر"` + red "هشدار واگرایی شارپ" chip when `sharpAlert`), FT (football `${homeScore}-${awayScore}` / tennis `setResult`), status badge برد(WON)/پوش(VOID)/باخت(LOST), price + net P/L, lock←settle timestamps, **full SHA-256** in mono chip dir="ltr" break-all.

All Persian RTL, numbers in `.num` spans with dir="ltr". Removed old radar/gyro modules and the `@/core/bookmakers/market-aliases` + `@/lib/format` imports (server-code-adjacent; day-key reimplemented inline per spec).

## 4. AppShell (minimal diff)

NAV labels set exactly (added `sub` field, same keys/icons/order; desktop+Sheet nav render label + secondary line; mobile tab bar keeps Persian `short`):
- overview → **Overview** / داشبورد عملکرد
- signals → **Predictions Hub** / مرکز پیش‌بینی
- ledger → **Hit-Rate Ledger** / کارنامه سربه‌سر
- lab → **Calibration Lab** / آزمایشگاه سوپرایجنت
- telegram → **Telegram Studio** / استودیو تلگرام

Footer version badge: `v2.7.2` → **`v3.1 SUPERAGENT`**. Nothing else touched (search/betslip/footer logic intact).

## Verification

- `bunx tsc --noEmit`: **0 errors in src/** (only pre-existing examples/ + skills/ errors remain).
- `bun run lint`: **clean** (fixed one `react-hooks/set-state-in-effect` error by switching HeroQuantum3D to useSyncExternalStore).
- `curl http://localhost:3000` → HTTP 200; SSR HTML contains new nav labels + "v3.1 SUPERAGENT"; zero compile errors mentioning my files in dev.log. (OverviewView renders client-side after /api/bootstrap, as before.)
- Live payload check: `agentLab` present (zeroed until backend trains); signal `tier/shieldType/noLossProb/consensusPct/sharpSource/sharpAlert` currently undefined on the wire — all UI fallbacks (badges hidden, "—", sharp-sensor text) verified by design against this state.

## Notes for next agents (backend)

- dev.log shows `src/core/agents/v31-migration.ts:52` Prisma error: `Unknown argument 'tier'` — the Prisma `Signal` model lacks the v3.1 columns (`tier`, `shieldType`, `noLossProb`, `consensusPct`, `sharpSource`, `sharpAlert`). Bootstrap still returns 200. Once backend adds columns + populates them, the Overview badges/consensus/sharp rows populate automatically — no frontend change needed.
- `/agent-ctx` root is not writable in the sandbox; this record lives at `/home/z/my-project/agent-ctx/`.
