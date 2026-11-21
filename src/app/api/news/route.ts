import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";

interface NewsItem {
  id: string;
  headline: string;
  description: string;
  published: string;
  link: string;
  image: string | null;
  source: string;
}

interface FeedDef { label: string; url: string }

/** REAL ESPN news wires — football (top leagues) + tennis (ATP/WTA). */
const FEEDS: FeedDef[] = [
  { label: "ESPN Football", url: `${ESPN_SITE}/soccer/eng.1/news` },
  { label: "ESPN Football", url: `${ESPN_SITE}/soccer/esp.1/news` },
  { label: "ESPN Tennis ATP", url: `${ESPN_SITE}/tennis/atp/news` },
  { label: "ESPN Tennis WTA", url: `${ESPN_SITE}/tennis/wta/news` },
];

async function fetchFeed(feed: FeedDef): Promise<NewsItem[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(feed.url, {
      signal: ctl.signal, cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      articles?: Array<Record<string, unknown>>;
    };
    return (j.articles ?? []).map((a) => {
      const images = a.images as Array<Record<string, unknown>> | undefined;
      const img = images?.find((i) => typeof i.url === "string");
      return {
        id: String(a.id ?? a.publishDate ?? Math.random()),
        headline: String(a.headline ?? "").slice(0, 200),
        description: String(a.description ?? "").slice(0, 400),
        published: String(a.published ?? a.lastModified ?? ""),
        link: String((a.links as Record<string, Record<string, { href?: string }>> | undefined)?.web?.href ?? "https://www.espn.com"),
        image: typeof img?.url === "string" ? img.url : null,
        source: feed.label,
      };
    }).filter((n) => n.headline.length > 0);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** GET /api/news — live ESPN football + tennis news (real wire only). */
export async function GET() {
  const results = await Promise.all(FEEDS.map(fetchFeed));
  const all = results.flat();
  // Dedupe by headline, newest first.
  const seen = new Set<string>();
  const items = all
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .filter((n) => {
      const key = n.headline.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 24);
  return NextResponse.json({ ok: true, items, fetchedAt: new Date().toISOString() });
}
