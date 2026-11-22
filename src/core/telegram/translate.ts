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
};
const faCache = (g.__neobetFaCache ??= new Map<string, string>());
const FA_CACHE_MAX = 400;

const SYSTEM_PROMPT =
  "You are a professional sports-news translator. Translate the given English " +
  "sports text into fluent, natural Persian (Farsi). Keep team and player names " +
  "in their original Latin form. Output ONLY the Persian translation — no " +
  "notes, no quotation marks, no transliteration of the source.";

async function llmTranslate(text: string): Promise<string | null> {
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, 1200) },
      ],
      thinking: { type: "disabled" },
    });
    const out = completion.choices[0]?.message?.content?.trim();
    if (!out || out.length < 2) return null;
    return out;
  } catch {
    return null;
  }
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
): Promise<{ headlineFa: string | null; descriptionFa: string | null }> {
  const key = `${headline}\n|||\n${description}`;
  const hit = faCache.get(key);
  if (hit) {
    const [h, d] = hit.split("\n---\n");
    return { headlineFa: h ?? null, descriptionFa: d ?? null };
  }
  try {
    const zai = await ZAI.create();
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
    const out = completion.choices[0]?.message?.content?.trim() ?? "";
    const [h, d] = out.split("\n---\n");
    if (!h || !d) return { headlineFa: null, descriptionFa: null };
    if (faCache.size >= FA_CACHE_MAX) {
      const first = faCache.keys().next().value;
      if (first) faCache.delete(first);
    }
    faCache.set(key, `${h}\n---\n${d}`);
    return { headlineFa: h.trim(), descriptionFa: d.trim() };
  } catch {
    return { headlineFa: null, descriptionFa: null };
  }
}
