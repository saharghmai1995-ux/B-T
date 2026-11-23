# NeoBet Quant Pro — Work Log

Engineering changelog for the NeoBet Quant Pro web app (Next.js 16 · TypeScript · Prisma/SQLite).
Each entry: scope, root causes, exact fixes, and the verification evidence (curl + real-browser).

---

## v3.3.1 — NBA Market Hotfix + Atomic Quantum Core Redesign

**Date:** 2026-11-23 · **Command file:** `upload/neobet_v331_nba_market_hotfix.md` (executed in full)
**Branch:** `main` · Commit: `feat(v3.3.1-...)` (this commit)

### §1 — NBA model root fix (99.1% overconfidence + `PUSH` settlement bug)

Root cause: the v3.3 selector fed raw net-rating differentials straight into the normal-CDF
margin model without clamping, producing 98.6% / 99.1% probabilities, and reused the football
market vocabulary (`1X2` / `AH_PLUS_025`) for NBA rows.

Fixes (`src/engines/nba/nba-selector.ts`):
- Per-game point differential strictly clamped to `[-12, +12]`; 70/30 blend with REAL ESPN
  standings win% (`homeWinPct` / `awayWinPct` now flow through `NbaMatchFeatures`).
- Expected home margin clamped `[-14, +14]`; `SIGMA = 12.2` (empirical NBA margin std dev).
- Hard caps: `pWin ∈ [0.12, 0.88]`, Alt +4.5 shield `∈ [0.50, 0.88]` — 99% outputs are
  structurally impossible now.
- Dedicated market keys `NBA_ML` / `NBA_ALT_SPREAD`; pick policy: Moneyline for ≥68%
  favourites, +4.5 Shield for 58%–67% favourites AND `pAlt ≥ 0.74`, silence below 58%.
- `buildCalibratedNbaPicks` (hotfix-exact) + `resolveNbaSelection` exported settlement.

Fixes (`src/core/ledger/settlement-engine.ts`):
- `resolveBasketball` settles the new keys via `resolveNbaSelection`; a half-point +4.5 line
  can NEVER push. Legacy `1X2` / `AH_PLUS_025` vocabulary still honoured so already-settled
  ledger rows never flip status.

Fixes (`src/core/pipeline/real-history-backfill.ts`):
- Backfill NBA branch tracks REAL in-window win% (`{g, diff, w, last}` form map) and emits
  the dedicated `NBA_ML` key.

### §2 — `w_market (20%)` activation with ZERO API keys (ESPN Core Odds)

Root cause: the NBA path passed `marketPrior = null` to `runEnsemble`, so
`SHARP MARKET PRIOR` stayed `0% / STANDBY` forever and the blend never used market weights.

Fixes (`src/core/agents/market-prior-sensor.ts`):
- `americanToImplied` + `fetchPublicEspnMarketPrior(sport, leagueSlug, eventId, pickSide)` —
  keyless ESPN Core API v2 per-event odds, de-vigged, 4s hard timeout, fully non-blocking.

Fixes (`src/core/agents/shield-integration.ts` + `src/core/pipeline/ingest-service.ts`):
- NBA ensemble fetches the real prior for the favourite side and activates
  `w_quant = 50% / w_coach = 30% / w_market = 20%` (`weightsWithMarket`); outage → honest
  0.65/0.35 model-only blend.
- `bootstrap-service.ts`: the DISPLAYED weights now mirror the live blend — any OPEN SHIELD
  signal with a real `sharpSource` flips the card `STANDBY → ACTIVE 20%` (no fake weights).

### §3 — Test-leak purge + NBA record rebuild + counter sync

Fixes (`src/core/pipeline/bootstrap-service.ts` — one-time `runV331DataHygieneMigration`,
flag `v331DataHygieneAt`):
- Purged every `Test Masters` / `Alpha vs Beta` / `Test League` Vitest-leak row
  (Match delete cascades Signals + Quotes; defensive Signal/ShadowVeto sweeps).
- Purged all uncalibrated NBA rows (old `1X2`/`AH_PLUS_025` keys or `modelProb > 0.90`)
  with their SHIELD vetoes, then fired the single-flight calibrated reseed.
- Vitest already runs on an isolated `db/test-invariants.db` (`vitest.config.ts`).

Fixes (counter sync — the `18 vs 15` bug):
- `AppShell.tsx` header counters + nav badge and `OverviewView.tsx` 3D-core `activePicks`
  now read the SAME `isStrictlyUpcoming` gate as the Predictions Hub list
  (kickoff > now + 5 min). All three surfaces can never disagree again.

### Atomic Quantum Core redesign (mobile-first, image-inspired)

`src/components/CinematicQuantumCore3D.tsx` rebuilt:
- The old module drew horizontal photon streams on a fixed 900px viewBox that floated
  over vertically-stacked cards on phones. Now there are TWO flow layers:
  vertical streams (`viewBox 360x760`) on mobile, horizontal (`900x360`) on `md+`.
- Central atomic core inspired by the reference artwork: glowing hot nucleus
  (health-coloured glow + white-hot gradient + breathing halo) inside **3 counter-rotating
  elliptical electron orbits** (rotZ 0°/60°/120° + rotateX 74°) with glowing electrons,
  dashed orbital guide circle and a deterministic deep-space starfield (54 stars,
  SSR-safe LCG, no hydration mismatch).
- Tilt interaction is mouse-only (`pointerType !== "mouse"` ignored) — phones keep a
  perfectly stable stage; reduced-motion users get static orbits (`prefers-reduced-motion`).
- `SHARP MARKET PRIOR` card shows a live green pulse + `ACTIVE 20%` when a real prior
  exists, honest `STANDBY` otherwise.
- New keyframes in `globals.css`: `nq-orbit-spin`, `nq-orbit-spin-rev`, `nq-core-pulse`,
  `nq-nucleus-breathe`, `nq-twinkle` (all disabled under reduced-motion).

### Verification evidence

| Check | Result |
| --- | --- |
| `bun run lint` | PASS (0 issues) |
| `/api/bootstrap` cold | HTTP 200 · 2.56s (migration + ingest) |
| `/api/bootstrap` steady | HTTP 200 · 0.068s |
| Hygiene flag | `v331DataHygieneAt` stamped; test-leak matches/vetoes = 0 |
| NBA keys in DB | only `NBA_ML` (13) + `NBA_ALT_SPREAD` (4) — legacy keys 0 |
| NBA max probability | **0.874** (was 0.991) — hard cap works |
| Keyless market prior | 7 OPEN NBA signals carry `sharpSource: ESPN_CORE_PUBLIC` |
| Card state | `SHARP MARKET PRIOR: ACTIVE 20%` (was `STANDBY`), weights 50/30/20 |
| Counter sync | Header chip = nav badge = 3D core = **13** everywhere |
| Browser (agent-browser) | desktop 1440×900 + mobile 390×844 — no page errors |
| Mobile overflow | `scrollWidth == innerWidth == 390` (zero horizontal overflow) |
| Interactivity | SUPERAGENT card click → Predictions Hub navigation works |
| Sticky footer | pushes naturally on long content, no floating gap |

Snapshots: `.snapshots/v331-desktop-dashboard-active.png`,
`.snapshots/v331-desktop-quantum-core.png`, `.snapshots/v331-mobile-dashboard.png`,
`.snapshots/v331-mobile-quantum-core-top.png`, `.snapshots/v331-mobile-signalcenter-nba.png`

---

## v2.7.2 — Bootstrap Unstick + Tennis EV Purge

**Date:** 2026-11-22 · Commit: `37298b0` (`fix(v2.7.2-bootstrap)`) + `65fd2d6` (`fix(v2.7.2-ops)`)

Root cause: the 30-day tennis history backfill ran synchronously inside `ensureBootstrapState`
and held every `/api/bootstrap` response for ~12s, pinning the dashboard on Skeleton Loading.

Fixes:
1. `real-history-backfill.ts` — purge query re-shaped to the actual Prisma schema inside
   try/catch (the old query crashed on schema drift); single-flight background runner
   (`tennisSeedInFlight` + `runTennisSeedBackground()` with `.finally` release).
2. `bootstrap-service.ts` — `void runTennisSeedBackground()` (fire-and-forget); the tennis EV
   migration stamps its one-time flag IMMEDIATELY after the purge so a slow re-seed can never
   re-trigger the destructive purge (the repeated-purge loop bug).
3. `odds-feed.ts` / `espn-history.ts` / `api/news/route.ts` — `AbortSignal.timeout(5000)` on
   every outbound fetch; two-layer API key resolver (`ODDS_API_IO_KEY ?? ODDSPAPI_API_KEY`).

Verification: cold 0.75s / steady 0.34–0.70s on `/api/bootstrap`; 970 REAL tennis matches
seeded in background; 3 open signals, mode LIVE; agent-browser desktop + mobile verified.

---

## v3.3 — Cinematic 3D Quantum Core + NBA Engine

**Date:** 2026-11-22 · Commit: `9daaa11` (`feat(v3.3-...)`)

- Engine 3 (NBA): normal-CDF margin model over REAL ESPN standings differentials + REAL
  schedule B2B/rest map (keyless scoreboard + standings feeds).
- Strict Pre-Match Gate (`isStrictlyUpcoming`, kickoff > now + 5 min) on the Predictions Hub.
- SuperAgent conflict veto calibrated 15pp → 22pp (the v3.2 audit killed the −6.9pp shadow
  lift: 31 missed wins vs 20 saved losses).
- League auto-veto HARD GATE: ≥12 settled matches AND win rate <62% (no small-sample vetoes).
- 25/25/25 backfill quotas + one-time v3.3 ledger migration with immediate flag stamping.
