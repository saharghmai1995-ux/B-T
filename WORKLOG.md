# NeoBet Quant Pro — Work Log

> Ledger-driven quantitative betting engine — Next.js 16 + TypeScript + Prisma/SQLite.
> Every change is REAL-data-only (Zero-Mock): no simulated fixtures, no invented prices.

---

## v3.4 — @Aineobet_bot Full VIP Gate (2026-11-24)

**Directive:** «بات متصل — @Aineobet_bot را کامل مدیریت کن. کانال VIP با لینک اختصاصی در دسترس است ولی در این کانال با این ای دی ادمین است.»

### Discovery (all values read live from the real Bot API)
- Bot `@Aineobet_bot` (id `9147801427`, "NeoBet Bot 🤖") — token verified via `getMe`.
- VIP channel **`-1004487154797` — "NeoBet VIP 👑"** discovered from `getUpdates`
  (`my_chat_member` stream); persisted in Setting `telegramVipChannelId`.
- Bot status inside the VIP channel: **administrator** with
  `can_invite_users=true`, `can_restrict_members=true`, `can_post_messages=true`
  (join-request approval on channels rides `can_invite_users`).
- Channel creator: `Amirkhan_69` (id `102140064`). Live member count: 3.

### §1 — Schema (`prisma/schema.prisma`)
- `VipInviteLink` — dedicated-link ledger (label, memberLimit, expireAt, isRevoked).
- `VipJoinRequest` — join requests captured from the live updates stream.
- `VipMemberEvent` — honest event stream (LINK_CREATED / LINK_REVOKED /
  JOIN_REQUEST / AUTO_APPROVED / MEMBER_JOINED / MEMBER_LEFT / MEMBER_KICKED /
  ADMIN_ACTION / ADMIN_ALERT).

### §2 — Bot API primitives (`src/core/telegram/bot-client.ts`)
- `createChatInviteLink` / `revokeChatInviteLink` (dedicated single-use links).
- `approveChatJoinRequest` / `declineChatJoinRequest` / `kickChatMember`
  (ban+unban classic kick, re-join stays possible).
- `getChatMember` / `getChatMemberCount` / `getChatAdministrators`.
- `getUpdates` long-poll (25s, own timeout envelope, `allowed_updates`
  incl. `chat_join_request` + `chat_member`).

### §3 — VIP service (`src/core/telegram/vip-service.ts`)
- Full management surface: mint/revoke dedicated links, approve/decline join
  requests, kick member, auto-approve switch (`vipAutoApprove` setting),
  status aggregation (bot + channel + rights + head-count + admins).
- Honesty rule preserved: DB rows are stamped ONLY after a confirmed Bot-API
  result; failures surface verbatim.

### §4 — Live updater (`src/core/telegram/updater.ts`)
- Self-healing in-process long-poll loop booted with the Warm Engine →
  **@Aineobet_bot stays fully LIVE without any browser**.
- Handles: `chat_join_request` (→ DB + optional auto-approve via REAL
  approveChatJoinRequest), `chat_member`/`my_chat_member` transitions,
  private commands `/start` `/id` `/help` (real HTML replies).
- Offset persisted in Setting `telegramUpdateOffset` (survives restarts);
  mutex prevents concurrent getUpdates (409-Conflict guard, verified).

### §5 — API (`src/app/api/telegram/vip`)
- `GET` → full gate state (status/links/requests/events/updater heartbeat).
- `POST` actions: `create_link` `revoke_link` `approve_request`
  `decline_request` `kick_member` `toggle_auto_approve` `poll_now`
  `set_channel`.

### §6 — UI (`src/components/views/VipAccessManagerCard.tsx`)
- New "دروازه VIP" console under the channel manager in Telegram Studio:
  live rights chips, member count, admin board, auto-approve switch,
  manual event sweep, kick-by-ID, single-use link minting (1/5/10/∞ uses ×
  24h/72h/7d/30d/never + admin-approval flag), link ledger with copy/open/
  revoke, pending join-request queue, event stream.

### Verification (all REAL Bot-API round-trips)
- `create_link` → `https://t.me/+OLq75ct4s4gxM2E0` (1 use, 24h) minted on
  Telegram ✅ → `revoke_link` → Telegram-side revoked ✅.
- `toggle_auto_approve` → ON ✅; `poll_now` → clean (mutex verified — the
  first attempt reproduced the 409 Conflict, then guarded) ✅.
- Updater heartbeat in dev.log: `[tg-updater] started — @Aineobet_bot live
  long-poll every 25s (+1.5s idle)`; offset persisted ✅.
- agent-browser desktop 1440×900 + mobile 390×844 — VIP gate renders with
  all rights chips green, zero console errors ✅
  (`.snapshots/v34-desktop-vipgate.png`, `.snapshots/v34-mobile-vipgate-viewport.png`,
  `.snapshots/v34-desktop-telegram-studio.png`, `.snapshots/v34-mobile-390-vipgate.png`).

---

## v3.3.2 — Bookmaker Realism + RCA Patch + Always-Warm Engine (2026-11-24)

**Patch:** `upload/neobet_v332_bookmaker_realism_and_rca_patch.md` — all 5 sections applied.
**Directive:** the engine core and the dashboard must stay hot WITHOUT any browser — engine + sandbox always warm and alive.

### §1 — NBA real bookmaker markets (`src/engines/nba/nba-selector.ts`)
- **Golden rule enforced:** a favourite NEVER gets a plus handicap — the v3.3.1
  `NBA Alt Spread +4.5` emission is structurally dead.
- New legal vocabulary: `NBA_ML` / `NBA_HCP_MINUS_2` / `NBA_HCP_MINUS_3`
  (favourite, full push shield on the exact 2/3-pt win) and
  `NBA_HCP_PLUS_5` / `NBA_HCP_PLUS_6` (underdog in close matchups, push on the
  exact 5/6-pt loss).
- Bottom-table teams (season win% < 45%) never receive a Match Winner signal.
- `buildRealBookmakerNbaPick` (patch-exact math: clamp PF−PA [-12,12], 70/30
  win% blend, margin [-14,14], SIGMA 12.2) + `resolveNbaSelection` returning
  **WON / PUSH / LOST** for whole-number lines (regex line parser).

### §1b/§4.2 — Settlement engine (`src/core/ledger/settlement-engine.ts`)
- NBA whole-number handicaps settle with an honest **PUSH** (→ VOID at 1.00,
  stake returned); legacy v3.3/v3.3.1 keys still settle (rows never flip).
- Tennis retirement rules (patch-exact): `TENNIS_SET_PLUS_15` with ≥1 set won
  before the retirement → **WON**; otherwise PUSH — **never LOST again**.
  Retirement is detected from BOTH the feed flag and the stored result string
  (`"… 0-0 ret"` rows the old `ret\.`-only regex missed — `espn-history.ts`
  widened to `\b(ret\.?|retired|walkover|w/o)\b`).

### §2 — Readable market vocabulary (`src/core/bookmakers/market-aliases.ts`, `src/lib/markets.ts`)
- `CleanMarketLabel.subtitleFa` added; full patch table live on every surface:
  `Match Winner — {Team}`, `Draw No Bet (0.0)`, `Double Chance (1X)`,
  `Total Goals: Over 2.0 / Under 3.0`, `Win at Least 1 Set — {Player}`,
  `Points Handicap (±N) — {Team}` + Persian subtitles (web cards + captions;
  Telegram poster stays 100% English).

### §3 — Max 1 card per fixture (`src/core/pipeline/active-picks-service.ts`)
- `dedupeOneCardPerFixture` — highest `noLossProb` card per `matchId` wins;
  applied to Predictions Hub in `bootstrapState` (ACCA rows stay outside).
- Result: `Chapecoense vs Palmeiras`-style triple cards are impossible; live
  board = 28 unique-fixture cards.

### §4.1 — Football low-scoring leagues (`dixon-coles.ts`, `football-selector.ts`)
- `mex.1 / eng.2 / bra.1 / arg.1 / esp.2` → fitted lambdas dampened **0.88x**
  before the score matrix (model + consensus boards consistently).
- `OVER_2_0` signalable ONLY when `lambdaHome + lambdaAway ≥ 2.85`
  (`OVER_2_0_MIN_LAMBDA_SUM`), probability hard-capped at **82%**.

### §4.2b/§4.3 — Tennis cap + veto calibration (`push-shield-selector.ts`, `orchestrator.ts`)
- `TENNIS_SET_PLUS_15` calibrated probability locked at **≤ 85%** (kills the
  audited "Overconfidence 92.3% on Blinkova").
- Superagent conflict veto widened **22pp → 24pp**; league auto-veto stays
  behind the hard gate (≥ 12 settled matches AND win rate < 62%).

### §4.3 — One-time v3.3.2 rebuild (`bootstrap-service.ts`)
- `runV332RealismMigration` (flag `v332RealismMigrationAt`, contained,
  single-flight): purged all settled NBA rows + every illegal OPEN
  `NBA_ALT_SPREAD` card + tennis LOST rows on ret/w-o matches, then rebuilt
  from the REAL ESPN 14-day backfill under v3.3.2 rules.

### Always-Warm Engine (directive — browser-independent)
- `src/core/pipeline/warm-engine.ts` — self-healing chained timer (mutex,
  10-min cadence, 60s fast retry after failure): live ingest **AND** a full
  dashboard-state build every tick; the built `AppState` is cached (45s TTL).
- `/api/bootstrap` serves the warm cache instantly; **`/api/health`** (new)
  is a headless liveness probe (engine stats + DB check, 200/503).
- Global single-flight added to `seedRealHistory` (+ observable start/done
  logs on the background reseed) — no duplicate rebuild passes.
- Measured: `/api/bootstrap` **14 ms** from warm cache (cold build 8–107 s);
  engine warm-ups happen with ZERO browser requests.

### Verification (agent-browser + DB)
- Desktop 1440×900 + mobile 390×844: dashboard, quantum core, Prediction Hub,
  NBA cards (`Match Winner`, `Points Handicap (-3)`), Persian subtitles,
  settlement rule text — all render clean, no console errors.
- DB audit: NBA markets = `{NBA_ML:11, NBA_HCP_MINUS_3:10, NBA_HCP_MINUS_2:4,
  NBA_HCP_PLUS_6:3}` — zero `NBA_ALT_SPREAD`; LOST-on-ret tennis rows = **0**;
  UNDER_3_0 push on exactly-3-goal games settled VOID (stake returned).
- Snapshots: `.snapshots/v332-*.png`.

---

## v2.7.2 — Dashboard Freeze + Timeout Hotfix (2026-11-23)

**Commit:** `37298b0` (origin/main, 6 files, +119/−61).
- Tennis EV migration purge query aligned 1:1 with `prisma/schema.prisma`,
  wrapped in try/catch (never crashes bootstrap).
- `AbortSignal.timeout(5000)` on every external fetch (`odds-feed.ts`,
  `espn-history.ts`, `/api/news`); 30-day tennis backfill moved to a
  non-blocking single-flight background runner (`runTennisSeedBackground`).
- `/api/bootstrap` measured: cold 0.75 s / steady 0.34–0.70 s; HTTP 200
  verified after restart; dashboard verified desktop + mobile 390×844.
- `.env.local` rebuilt (THE_ODDS_API_KEY + ODDS_API_IO_KEY + TELEGRAM_BOT_TOKEN,
  chmod 600, git-ignored); `oddsApiIo` health flag honours the full resolver
  chain (DB → env).

---

## Version history (commits)

| Version | Commit | Theme |
| --- | --- | --- |
| v3.3.1 | `618df3f` | Calibrated NBA model + keyless w_market 20% + mobile redesign |
| v3.3 | `9daaa11` | Cinematic 3D quantum core + NBA engine + strict pre-match gate |
| v3.2 | `c6ad0c9` | Zero-bankroll purge + WebGL-free live telemetry core |
| v3.1 | `35e9ebc` | Parallel SuperAgent Hit-Rate & Downside-Shield Engine |
| v2.7.2 | `37298b0` | Kill dev-server freeze + 5s fetch ceilings |
