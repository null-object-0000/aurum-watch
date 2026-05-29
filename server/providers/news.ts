import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { config } from "../config.js";
import type { Direction, NewsEvent } from "../types.js";

type NewsNowItem = {
  id: string;
  title: string;
  url: string;
  pubDate?: string;
  time?: string;
};

type NewsNowSource = {
  id: string;
  name: string;
};

const targetSources: NewsNowSource[] = [
  { id: "jin10", name: "金十数据" },
  { id: "wallstreetcn-quick", name: "华尔街见闻" },
  { id: "cls-telegraph", name: "财联社" }
];

const keywords = ["金", "美联储", "降息", "加息", "利率", "通胀", "CPI", "美元", "汇率", "人民币", "非农", "就业", "美债", "避险", "战争", "冲突"];

const bullishTerms = ["避险", "战争", "降息", "地缘", "冲突", "买入", "通胀", "宽松", "上行", "支撑"];
const bearishTerms = ["加息", "收紧", "鹰派", "下跌", "利空", "强劲", "打压", "美联储维持"];

let lastFetchTime = 0;
let cachedResult: { events: NewsEvent[]; status: "ok" | "error"; detail: string } | null = null;
const NEWS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const NEWS_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cool-off on failure

function fetchWithProxy(urlStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json"
    };

    if (proxyUrl) {
      const proxy = new URL(proxyUrl);
      
      if (url.protocol === "https:") {
        const connectReq = http.request({
          host: proxy.hostname,
          port: proxy.port || 80,
          method: "CONNECT",
          path: `${url.hostname}:443`,
          headers: {
            Host: `${url.hostname}:443`
          }
        });

        connectReq.on("connect", (res, socket) => {
          if (res.statusCode === 200) {
            const agent = new https.Agent({ keepAlive: true });
            (agent as any).createConnection = () => socket;
            const req = https.get(urlStr, { headers, agent }, (response) => {
              let data = "";
              response.on("data", (chunk) => data += chunk);
              response.on("end", () => {
                if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                  resolve(data);
                } else {
                  reject(new Error(`NewsNow API HTTP ${response.statusCode}`));
                }
              });
            });
            req.on("error", reject);
          } else {
            reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
          }
        });

        connectReq.on("error", reject);
        connectReq.end();
      } else {
        const req = http.get({
          host: proxy.hostname,
          port: proxy.port || 80,
          path: urlStr,
          headers
        }, (response) => {
          let data = "";
          response.on("data", (chunk) => data += chunk);
          response.on("end", () => {
            if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`NewsNow API HTTP ${response.statusCode}`));
            }
          });
        });
        req.on("error", reject);
      }
    } else {
      const getFn = url.protocol === "https:" ? https.get : http.get;
      const req = getFn(urlStr, { headers }, (response) => {
        let data = "";
        response.on("data", (chunk) => data += chunk);
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`NewsNow API HTTP ${response.statusCode}`));
          }
        });
      });
      req.on("error", reject);
    }
  });
}

export async function fetchNewsEvents(force = false): Promise<{ events: NewsEvent[]; status: "ok" | "error"; detail: string }> {
  const now = Date.now();
  const ttl = cachedResult?.status === "ok" ? NEWS_CACHE_TTL_MS : NEWS_FAILURE_CACHE_TTL_MS;
  if (!force && cachedResult && now - lastFetchTime < ttl) {
    return cachedResult;
  }

  try {
    const allFetchedEvents: NewsEvent[] = [];
    const fetchErrors: string[] = [];

    // Fetch from all targets in parallel
    await Promise.all(
      targetSources.map(async (source) => {
        try {
          const url = `${config.newsnowBaseUrl}/api/s?id=${source.id}`;
          const text = await fetchWithProxy(url);
          const payload = JSON.parse(text) as { items?: NewsNowItem[] };
          
          if (!payload.items || !Array.isArray(payload.items)) {
            throw new Error(`Invalid NewsNow items structure for source ${source.id}`);
          }

          // Filter articles by keywords to ensure relevance to gold/macroeconomy
          const filtered = payload.items.filter((item) =>
            keywords.some((kw) => item.title.includes(kw))
          );

          // Map items to NewsEvents
          for (const item of filtered) {
            allFetchedEvents.push(toEvent(item, source.name));
          }
        } catch (err) {
          fetchErrors.push(`${source.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      })
    );

    // If all sources failed, throw an error
    if (fetchErrors.length === targetSources.length) {
      throw new Error(`All sources failed: ${fetchErrors.join("; ")}`);
    }

    // Sort by publication date descending (newest first)
    const sortedEvents = allFetchedEvents.sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
    );

    // De-duplicate by title/URL to prevent double entries across sources
    const uniqueEvents: NewsEvent[] = [];
    const seenTitles = new Set<string>();
    for (const ev of sortedEvents) {
      if (!seenTitles.has(ev.title)) {
        seenTitles.add(ev.title);
        uniqueEvents.push(ev);
      }
    }

    // Keep the top 20 most recent events
    const events = uniqueEvents.slice(0, 20);

    cachedResult = {
      events,
      status: "ok",
      detail: `${events.length} articles from NewsNow (${targetSources.map(s => s.id).join(", ")})`
    };
    lastFetchTime = now;
    return cachedResult;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "NewsNow API fetch failed";
    cachedResult = { events: [], status: "error", detail: reason };
    lastFetchTime = now;
    return cachedResult;
  }
}

function toEvent(item: NewsNowItem, sourceName: string): NewsEvent {
  const title = item.title.trim();
  const lower = title.toLowerCase();
  const dir = getDirection(lower);
  const scoreVal = Math.min(48, Math.round(title.length / 3));
  const impact = dir === "bullish" ? 25 + scoreVal : dir === "bearish" ? -25 - scoreVal : 0;

  return {
    id: crypto.createHash("sha1").update(item.url || title).digest("hex"),
    time: new Date(item.pubDate || item.time || Date.now()).toISOString(),
    source: sourceName,
    title,
    category: classify(lower),
    direction: dir,
    impact: Math.max(-100, Math.min(100, impact)),
    summary: title,
    url: item.url
  };
}

function classify(text: string) {
  if (text.includes("美联储") || text.includes("降息") || text.includes("加息") || text.includes("利率")) return "美联储";
  if (text.includes("美元") || text.includes("usd")) return "美元";
  if (text.includes("债") || text.includes("国债")) return "美债";
  if (text.includes("避险") || text.includes("地缘") || text.includes("冲突") || text.includes("乌克兰") || text.includes("中东")) return "地缘政治";
  if (text.includes("通胀") || text.includes("cpi") || text.includes("ppi")) return "通胀";
  return "黄金市场";
}

function getDirection(text: string): "bullish" | "bearish" | "neutral" {
  const bullish = bullishTerms.some(term => text.includes(term));
  const bearish = bearishTerms.some(term => text.includes(term));
  if (bullish && !bearish) return "bullish";
  if (bearish && !bullish) return "bearish";
  return "neutral";
}
