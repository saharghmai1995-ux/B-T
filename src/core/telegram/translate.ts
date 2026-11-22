/**
 * Persian Translation Service (v2.7) — server-only bilingual news pipeline.
 * Uses z-ai-web-dev-sdk (backend) to translate ESPN headlines/summaries into
 * fluent Persian. Results are cached on globalThis per source text so every
 * repeat render/dispatch is instant and quota-free. Honest failure: when the
 * model is unreachable the caller receives null and the UI shows EN only —
 * no machine-mangled placeholder is ever faked.
 */

import ZAI from "z-ai-web-dev-sdk";

const g = globalThis as unknown as {
  __neobetFaCache?: Map<string, string>;
  __neobetZai?: Awaited<ReturnType<typeof ZAI.create>>;
  __neobetLlmQueue?: { chain: Promise<void>; last: number };
};
const faCache = (g.__neobetFaCache ??= new Map<string, string>());
const FA_CACHE_MAX = 400;

/** Singleton ZAI client — one per process (skill best practice: reuse the instance). */
async function zaiClient() {
  if (!g.__neobetZai) g.__neobetZai = await ZAI.create();
  return g.__neobetZai;
}

/**
 * Global LLM rate limiter — the gateway answers 429 under bursts, so every
 * call passes through a serialized queue with a minimum gap (1.6s). The FA
 * cache fills progressively across the 120s radar polls; only the first
 * cycle pays, and everything already translated is instant.
 */
const limiter = (g.__neobetLlmQueue ??= {
  chain: Promise.resolve() as Promise<void>,
  last: 0,
});
const MIN_GAP_MS = 1600;

function limit<T>(fn: () => Promise<T>): Promise<T> {
  const run = limiter.chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - limiter.last));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    limiter.last = Date.now();
  });
  limiter.chain = run.catch(() => {});
  return run.then(fn);
}

const SYSTEM_PROMPT =
  "You are a professional sports-news translator. Translate the given English " +
  "sports text into fluent, natural Persian (Farsi). Keep team and player names " +
  "in their original Latin form. Output ONLY the Persian translation — no " +
  "notes, no quotation marks, no transliteration of the source.";

async function llmTranslate(text: string, retries = 1): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const out = await limit(async () => {
        const zai = await zaiClient();
        const completion = await zai.chat.completions.create({
          messages: [
            { role: "assistant", content: SYSTEM_PROMPT },
            { role: "user", content: text.slice(0, 1200) },
          ],
          thinking: { type: "disabled" },
        });
        return completion.choices[0]?.message?.content?.trim() ?? "";
      });
      if (out && out.length >= 2) return out;
    } catch {
      if (attempt < retries) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  return null;
}

/** Translate an English text to Persian with a global cache. Null on failure. */
export async function translateToFa(text: string): Promise<string | null> {
  const key = text.trim();
  if (!key) return null;
  const hit = faCache.get(key);
  if (hit) return hit;
  const fa = await llmTranslate(key);
  if (!fa) return null;
  if (faCache.size >= FA_CACHE_MAX) {
    const first = faCache.keys().next().value;
    if (first) faCache.delete(first);
  }
  faCache.set(key, fa);
  return fa;
}

/** Translate headline + description in ONE model call ("H ||| D" protocol). */
export async function translateNewsPair(
  headline: string,
  description: string,
  retries = 1,
): Promise<{ headlineFa: string | null; descriptionFa: string | null }> {
  const key = `${headline}\n|||\n${description}`;
  const hit = faCache.get(key);
  if (hit) {
    const [h, d] = hit.split("\n---\n");
    return { headlineFa: h ?? null, descriptionFa: d ?? null };
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const out = await limit(async () => {
        const zai = await zaiClient();
        const completion = await zai.chat.completions.create({
          messages: [
            {
              role: "assistant",
              content:
                "Translate the sports news below into fluent Persian. Input has a " +
                "HEADLINE line and a DESCRIPTION line separated by '|||'. Reply with " +
                "EXACTLY two lines separated by '---': line 1 = Persian headline, " +
                "line 2 = Persian description. Keep names in Latin script. No extra text.",
            },
            { role: "user", content: `${headline}\n|||\n${description}` },
          ],
          thinking: { type: "disabled" },
        });
        return completion.choices[0]?.message?.content?.trim() ?? "";
      });
      // Tolerant parse: exact '---' separator, dashed variants, or the first
      // two non-empty lines — whichever the model actually produced.
      const lines = out.split("\n").map((l) => l.trim()).filter((l) => l && !/^[-=]{2,}$/.test(l));
      let h: string | undefined;
      let d: string | undefined;
      if (out.includes("\n---\n")) {
        [h, d] = out.split("\n---\n");
      } else if (lines.length >= 2) {
        [h, d] = [lines[0], lines.slice(1).join(" ")];
      }
      if (h && d) {
        if (faCache.size >= FA_CACHE_MAX) {
          const first = faCache.keys().next().value;
          if (first) faCache.delete(first);
        }
        faCache.set(key, `${h}\n---\n${d}`);
        return { headlineFa: h.trim(), descriptionFa: d.trim() };
      }
    } catch {
      if (attempt < retries) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  return { headlineFa: null, descriptionFa: null };
}
