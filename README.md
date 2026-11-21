# NeoBet Quant Pro — B-T

پلتفرم تحلیل کوانت فوتبال و تنیس با داشبورد RTL فارسی، دفتر کل SHA-256 و سه خط تولید سیگنال (تک‌شرط EV، میکس هوشمند ۲تایی، آربیتراژ).

## راه‌اندازی سریع (Fresh Clone)

```bash
git clone https://github.com/saharghmai1995-ux/B-T.git
cd B-T
bun install        # یا npm install
bun run dev        # ← اسکیمای دیتابیس به‌صورت خودکار ساخته می‌شود و سرور روی پورت 3000 بالا می‌آید
```

- `bun run dev` به‌طور خودکار: اگر `.env` نبود می‌سازد، پوشه‌ی `db/` را می‌سازد، `prisma db push` را اجرا می‌کند و سپس Next.js را روی پورت 3000 استارت می‌کند.
- نیازی به تنظیم دستی نیست؛ برای سفارشی‌سازی، `.env.example` را ببینید.

## منبع داده — LIVE و SIM

| حالت | توضیح | برچسب در UI |
|------|-------|-------------|
| **LIVE** | فید زنده‌ی ESPN (فوتبال ۱۹ لیگ + تنیس ATP/WTA) با ضرایب مرجع واقعی | «1xBet / ESPN Live» با نقطه سبز |
| **SIM** | اگر ESPN در دسترس نباشد (تحریم، فایروال، قطعی شبکه)، فید **شبیه‌سازی قطعی** جایگزین می‌شود تا داشبورد هرگز خالی نماند | «حالت شبیه‌سازی (SIM)» با نقطه کهربایی |

### منطق ضد-داده‌خالی (Cold-Start Safe)

1. `/api/bootstrap` اگر دیتابیس خالی باشد، بلافاصله ingest اجرا می‌کند.
2. اگر ESPN در دسترس نباشد، بسته‌ی SIM قطعی (دترمیینیستیک با PRNG) تولید می‌شود — همان روز، همان داده؛ اسنپ‌شات‌ها پایدار می‌مانند.
3. اگر هیچ ردیف تسویه‌شده وجود نداشته باشد، **History Seed** ۱۴ روز گذشته را با موتورهای واقعی (Dixon-Coles / Markov-Copula) و موتور تسویه‌ی واقعی پر می‌کند.
4. ردیف‌های SIM در دیتابیس با `Match.source = "SIM"` ذخیره می‌شوند و هرگز با ردیف‌های واقعی ESPN قاطی نمی‌شوند. فیکسچرهای SIM بدون سیگنال به‌صورت خودکار پاک‌سازی می‌شوند.

> شفافیت: در حالت SIM داده‌های نمایشی تولید می‌شوند و در UI با برچسب کهربایی مشخص است؛ در حالت LIVE همه‌ی ضرایب و نتایج واقعی هستند.

### حالت دمو اجباری (اختیاری)

```bash
BET_SIM_FORCE=1 bun run dev
```

برای دمو/آفلاین بدون هیچ تماس شبکه‌ای.

## اسکریپت‌ها

| دستور | کار |
|------|-----|
| `bun run dev` | استارت توسعه با خودراه‌اندازی دیتابیس (پورت 3000) |
| `bun run lint` | بررسی کیفیت کد |
| `bun run db:push` | اعمال اسکیمای Prisma روی SQLite |
| `bun run test` | تست‌های invariant |
| `./scripts/snapshot-push.sh "پیام"` | اسنپ‌شات گیت + push به GitHub |

## اسنپ‌شات بعد از هر تغییر (Git Workflow)

```bash
# یک‌بار: توکن را ست کنید
GITHUB_TOKEN=github_pat_xxx ./scripts/snapshot-push.sh "feat: initial snapshot"

# دفعات بعد (توکن در remote ذخیره شده است)
./scripts/snapshot-push.sh "feat: change description"
```

## معماری داده

- **Engines**: فوتبال Dixon-Coles + تنیس Markov-Copula (`src/engines/`)
- **Pipeline**: `feed-gatherer → signal-factory → rca-veto → ledger` (`src/core/pipeline/`)
- **Ledger**: زنجیره SHA-256 + موتور تسویه صادقانه (`src/core/ledger/`)
- **Feed boundary**: `src/core/bookmakers/odds-feed.ts` (ESPN) و `src/core/pipeline/sim-feed.ts` (SIM)
- **DB**: Prisma + SQLite (`prisma/schema.prisma`)، فایل در `db/custom.db` (جزو گیت نیست)

## استک

Next.js 16 (App Router) · TypeScript 5 · Tailwind CSS 4 · shadcn/ui (New York) · TanStack Query · Zustand · Prisma (SQLite)
