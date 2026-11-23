# Task 4-d — SuperAgent Calibration Lab rebuild (Tab 4)

Agent: 4-d | Status: DONE | Verified: tsc 0 errors in src/, lint 0 errors in owned files, dev.log clean (GET / 200).

## Files created / modified

| File | Lines | Change |
|---|---|---|
| `src/components/views/QuantLabView.tsx` | 154 | REWRITTEN — 4 sub-tabs, default = کالیبراسیون, ErrorBoundary cages, TennisFeedStatus preserved |
| `src/components/views/lab/CalibrationLab.tsx` | 546 | NEW — SuperAgent 3 dashboard over `state.agentLab` |
| `src/components/views/lab/LabErrorBoundary.tsx` | 120 | NEW — shared class ErrorBoundary for 3D lab modules |
| `src/components/views/lab/Pitch3D.tsx` | 346 | PATCHED — dir=ltr λ formulas, SVG label overlap fix, mobile-safe heatmap axis |
| `src/components/views/lab/Court3D.tsx` | 274 | UNCHANGED (only wrapped in boundary by QuantLabView) |
| `src/components/views/lab/QqlConsole.tsx` | 187 | UNCHANGED (POST /api/qql behavior intact; no props needed) |

## ErrorBoundary design (`LabErrorBoundary.tsx`)
- Class component: `getDerivedStateFromError` → `{hasError, message}`, `componentDidCatch` logs `[LabErrorBoundary:label]` + component stack to console only.
- Fallback = `.glass` panel, `role="alert"`, ShieldAlert icon, Persian copy «حالت امن فعال شد — {label}», raw error in `dir=ltr` mono code box, retry button **«بازگشت به حالت امن»**.
- Retry mechanism: button bumps internal `attempt` state → returned wrapper is `<div key={attempt} style={{display:"contents"}}>` → key change force-remounts the whole child subtree (fresh hooks/state/animations); `display:contents` keeps parent grid layout untouched.
- Wired: `<Pitch3D>` and `<Court3D>` wrapped with `testId="pitch-boundary"` / `"court-boundary"`; QqlConsole intentionally not wrapped (spec scope).

## 4 sub-tab structure (QuantLabView)
`TABS = [calibration (DEFAULT), pitch, court, qql]` — labels: آزمایشگاه کالیبراسیون | ⚽ زمین فوتبال 3D | 🎾 زمین تنیس Hawk-Eye 3D | 🧬 کنسول QQL & AI RCA. Active tab styles: amber/emerald/cyan/violet neon. `role="tablist"` + `role="tab"` + `aria-selected`. **TennisFeedStatus renders only for pitch/court/qql** (hidden on calibration tab per spec), body switches below it.

## CalibrationLab contents (all optional-guarded, `agentLab undefined → EmptyState «در حال جمع‌آوری داده کالیبراسیون…»`)
1. Header card: FlaskConical identity + decidedCount/settledCount badges + winStreak badge (emerald when ≥3) + `lastStatuses` neon dots (WON emerald / LOST red / VOID slate, max 16, legend included).
2. 5 glass `KpiTile`s: Brier (4 dec, violet), Log-Loss (4 dec, cyan), ECE (% 1 dec, gold), Pure Win Rate (% emerald), No-Loss Rate (% emerald). Server ships 0..1 fractions → ×100 (confirmed against `src/core/agents/calibration.ts`).
3. Reliability bins chart: Recharts `ComposedChart` h-64 — violet `Bar` (`#8B5CF6`, dataKey=outcome = avgOutcome×100), dashed gold `Line` (dataKey=predicted = avgPredicted×100 → visual y=x reference), Y domain [0,100] ticks 0/25/50/75/100 with % formatter, angled bin-range X labels (`60-70`), custom count-aware `BinsTooltip` (dir=ltr mono: predicted/outcome/count). Empty bins filtered; zero-bin fallback text. Title «نمودار کالیبراسیون (Reliability Bins)».
4. Live weights panel: wQuant/wCoach/wMarket progress bars (emerald/cyan/violet neon + glow) with % labels; Platt card: `sigmoid(a · logit(p) + b)` in `dir=ltr` mono code box, a/b toFixed(3), trainedOn + sub-12 “pass-through” note.
5. Shadow Ledger card: savedLossCount/Units, missedWinCount/Units, winRateWith/WithoutVeto, shadowLiftPct chip (+green/−red, pp).
6. Tier stats + Shield stats mini-tables (`max-h-52 overflow-y-auto scroll-slim`, dir=ltr, W/L/V/win%/no-loss%/n columns; `TierBadge`/`ShieldBadge` with raw-key fallback).
7. Vetoed leagues compact table (league/sport/count + «وتو» red tag, sorted by count desc, max-h-56 scroll-slim).

## Pitch3D fixes
- Stats strip λ segment now one atomic `<span dir="ltr" className="num whitespace-nowrap">λ_H x · λ_A y</span>`; matrix summary line λ/ρ formulas each in `dir=ltr` mono spans.
- SVG labels: moved λ_H arrow/label to y=24.5/21.6 (high, home side) and λ_A to y=38/42.6 (low, away side) so they no longer collide with centre circle/each other; fontSize 4.4→4; added dark `paintOrder="stroke"` outline for legibility over glow blobs; SVG elevated `z-20`; labels use JetBrains mono via `var(--font-jetbrains)`.
- Heatmap mobile: matrix wrapped in `overflow-x-auto scroll-slim` with inner `min-w-[300px]` grid → axis labels can never wrap/collide below 360px; they scroll instead.

## Verification
- `bunx tsc --noEmit` → 0 errors in src/ (examples/skills/tests ignored per protocol).
- `bun run lint` → 0 errors in my files. Only remaining repo error is pre-existing `src/components/three/HeroQuantum3D.tsx:202` (another agent's scope, untouched).
- dev.log: `GET /api/bootstrap 200`, `GET / 200`, `✓ Compiled` — no compile errors mentioning my files. (Pre-existing runtime Prisma warning from `src/core/agents/v31-migration.ts:52` `Unknown argument 'tier'` is backend-scope, not mine; CalibrationLab degrades gracefully to the EmptyState if `agentLab` is absent.)
