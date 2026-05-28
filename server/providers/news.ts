import crypto from "node:crypto";
import { config } from "../config.js";
import type { Direction, NewsEvent } from "../types.js";

type GdeltArticle = {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  sourcecountry?: string;
};

const bullishTerms = ["war", "conflict", "risk", "safe haven", "inflation", "cut", "easing", "central bank", "buying"];
const bearishTerms = ["dollar rises", "yields rise", "hawkish", "strong payrolls", "rate hike", "tightening"];

export async function fetchNewsEvents(): Promise<{ events: NewsEvent[]; status: "ok" | "error"; detail: string }> {
  try {
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", config.newsQuery);
    url.searchParams.set("mode", "ArtList");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", "20");
    url.searchParams.set("sort", "HybridRel");

    const response = await fetch(url);
    if (!response.ok) throw new Error(`GDELT ${response.status}`);
    const json = (await response.json()) as { articles?: GdeltArticle[] };
    const events = (json.articles ?? []).slice(0, 10).map(toEvent);
    return { events, status: "ok", detail: `${events.length} GDELT articles` };
  } catch (error) {
    return { events: [], status: "error", detail: error instanceof Error ? error.message : "GDELT failed" };
  }
}

function toEvent(article: GdeltArticle): NewsEvent {
  const title = article.title ?? "Untitled market event";
  const lower = title.toLowerCase();
  const bearish = bearishTerms.some((term) => lower.includes(term));
  const bullish = bullishTerms.some((term) => lower.includes(term));
  const direction: Direction = bearish && !bullish ? "bearish" : bullish ? "bullish" : "neutral";
  const impact = direction === "bullish" ? 30 + score(title) : direction === "bearish" ? -30 - score(title) : score(title) - 12;

  return {
    id: crypto.createHash("sha1").update(article.url ?? title).digest("hex"),
    time: parseGdeltDate(article.seendate),
    source: article.domain ?? "GDELT",
    title,
    category: classify(lower),
    direction,
    impact: Math.max(-100, Math.min(100, impact)),
    summary: title,
    url: article.url
  };
}

function score(input: string) {
  return Math.min(48, Math.round(input.length / 3));
}

function classify(text: string) {
  if (text.includes("fed") || text.includes("rate")) return "美联储";
  if (text.includes("dollar") || text.includes("usd")) return "美元";
  if (text.includes("yield") || text.includes("treasury")) return "美债";
  if (text.includes("war") || text.includes("conflict")) return "地缘政治";
  if (text.includes("inflation") || text.includes("cpi")) return "通胀";
  return "黄金市场";
}

function parseGdeltDate(value?: string) {
  if (!value) return new Date().toISOString();
  const compact = value.replace(/\D/g, "");
  if (compact.length < 14) return new Date().toISOString();
  return new Date(
    Date.UTC(
      Number(compact.slice(0, 4)),
      Number(compact.slice(4, 6)) - 1,
      Number(compact.slice(6, 8)),
      Number(compact.slice(8, 10)),
      Number(compact.slice(10, 12)),
      Number(compact.slice(12, 14))
    )
  ).toISOString();
}
