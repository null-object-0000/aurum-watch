import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import net from "node:net";
import { config } from "../config.js";
import type { Direction, NewsEvent } from "../types.js";
import { analyzeNewsItems, isLlmConfigured } from "./llm.js";

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

// ─── 相关性关键词过滤（仅保留黄金/宏观相关新闻）─────────────────────────

const keywords = ["金", "美联储", "降息", "加息", "利率", "通胀", "CPI", "美元", "汇率", "人民币", "非农", "就业", "美债", "避险", "战争", "冲突"];

// ─── Cache ────────────────────────────────────────────────────────────────

let lastFetchTime = 0;
let cachedResult: { events: NewsEvent[]; status: "ok" | "error"; detail: string } | null = null;
const NEWS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const NEWS_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cool-off on failure

// ─── Fetch ────────────────────────────────────────────────────────────────

function createSocks5Connection(
  proxyHost: string,
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  callback: (err: Error | null, socket?: net.Socket) => void
) {
  let callbackCalled = false;
  const safeCallback = (err: Error | null, resSocket?: net.Socket) => {
    if (callbackCalled) return;
    callbackCalled = true;
    callback(err, resSocket);
  };

  const socket = net.connect(proxyPort, proxyHost);

  socket.on("error", (err) => {
    safeCallback(err);
  });

  socket.once("close", () => {
    safeCallback(new Error("Connection to SOCKS proxy closed"));
  });

  socket.once("connect", () => {
    socket.write(Buffer.from([0x05, 0x01, 0x00]));

    socket.once("data", (data) => {
      if (data[0] !== 0x05 || data[1] !== 0x00) {
        socket.destroy();
        safeCallback(new Error("SOCKS5 negotiation failed"));
        return;
      }

      const hostBuffer = Buffer.from(targetHost, "utf8");
      const reqHeader = Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuffer.length]);
      const portBuffer = Buffer.alloc(2);
      portBuffer.writeUInt16BE(targetPort, 0);

      socket.write(Buffer.concat([reqHeader, hostBuffer, portBuffer]));

      socket.once("data", (data) => {
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          socket.destroy();
          safeCallback(new Error(`SOCKS5 CONNECT failed with code ${data[1]}`));
          return;
        }

        socket.removeAllListeners("error");
        socket.removeAllListeners("close");
        safeCallback(null, socket);
      });
    });
  });
}

function fetchWithProxy(urlStr: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    let resolvedOrRejected = false;
    let activeReq: any = null;

    const timeoutId = setTimeout(() => {
      if (resolvedOrRejected) return;
      resolvedOrRejected = true;
      if (activeReq) {
        try { activeReq.destroy(); } catch (_) {}
      }
      reject(new Error(`NewsNow fetch timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    const safeResolve = (val: string) => {
      if (resolvedOrRejected) return;
      resolvedOrRejected = true;
      clearTimeout(timeoutId);
      resolve(val);
    };

    const safeReject = (err: Error) => {
      if (resolvedOrRejected) return;
      resolvedOrRejected = true;
      clearTimeout(timeoutId);
      reject(err);
    };

    const url = new URL(urlStr);
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json"
    };

    if (proxyUrl) {
      const proxy = new URL(proxyUrl);
      const isSocks = proxy.protocol.startsWith("socks");

      if (isSocks) {
        const proxyHost = proxy.hostname;
        const proxyPort = Number(proxy.port || 1080);
        const targetHost = url.hostname;
        const targetPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));

        const agentOptions = { keepAlive: true };
        const agent = url.protocol === "https:"
          ? new https.Agent(agentOptions)
          : new http.Agent(agentOptions);

        (agent as any).createConnection = (opts: any, cb: any) => {
          createSocks5Connection(proxyHost, proxyPort, targetHost, targetPort, cb);
        };

        const getFn = url.protocol === "https:" ? https.get : http.get;
        const req = getFn(urlStr, { headers, agent }, (response) => {
          let data = "";
          response.on("data", (chunk) => data += chunk);
          response.on("end", () => {
            if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
              safeResolve(data);
            } else {
              safeReject(new Error(`NewsNow API HTTP ${response.statusCode}`));
            }
          });
        });
        activeReq = req;
        req.on("error", safeReject);
      } else {
        if (url.protocol === "https:") {
          const proxyReqFn = proxy.protocol === "https:" ? https.request : http.request;
          const connectReq = proxyReqFn({
            host: proxy.hostname,
            port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
            method: "CONNECT",
            path: `${url.hostname}:443`,
            headers: {
              Host: `${url.hostname}:443`
            }
          });
          activeReq = connectReq;

          connectReq.on("connect", (res, socket) => {
            if (res.statusCode === 200) {
              const agent = new https.Agent({ keepAlive: true });
              (agent as any).createConnection = () => socket;
              const req = https.get(urlStr, { headers, agent }, (response) => {
                let data = "";
                response.on("data", (chunk) => data += chunk);
                response.on("end", () => {
                  if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                    safeResolve(data);
                  } else {
                    safeReject(new Error(`NewsNow API HTTP ${response.statusCode}`));
                  }
                });
              });
              activeReq = req;
              req.on("error", safeReject);
            } else {
              safeReject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
            }
          });

          connectReq.on("error", safeReject);
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
                safeResolve(data);
              } else {
                safeReject(new Error(`NewsNow API HTTP ${response.statusCode}`));
              }
            });
          });
          activeReq = req;
          req.on("error", safeReject);
        }
      }
    } else {
      const getFn = url.protocol === "https:" ? https.get : http.get;
      const req = getFn(urlStr, { headers }, (response) => {
        let data = "";
        response.on("data", (chunk) => data += chunk);
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            safeResolve(data);
          } else {
            safeReject(new Error(`NewsNow API HTTP ${response.statusCode}`));
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

          // Map items to NewsEvents with neutral defaults（LLM 会后续覆盖）
          for (const item of filtered) {
            allFetchedEvents.push(toEventRaw(item, source.name));
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

    // ── LLM 分析（若已配置）──────────────────────────────────────────────
    if (isLlmConfigured()) {
      try {
        const llmResults = await analyzeNewsItems(
          events.map((e) => ({ id: e.id, title: e.title }))
        );
        let analyzedCount = 0;
        for (const event of events) {
          const result = llmResults.get(event.id);
          if (result) {
            event.category = result.category;
            event.direction = result.direction;
            event.impact = result.direction === "bullish"
              ? result.impactScore
              : result.direction === "bearish"
                ? -result.impactScore
                : 0;
            event.summary = result.summary || event.title;
            event.llmImpactScore = result.impactScore;
            event.llmAnalyzed = true;
            event.llmConfidence = result.confidence;
            event.llmImpactHorizon = result.horizon;
            event.llmLogs = result.llmLogs;
            analyzedCount++;
          }
        }
        // 如果 LLM 一条都没分析成功（全失败），标记为错误
        if (analyzedCount === 0) {
          throw new Error("LLM returned no results for any event");
        }
      } catch (llmErr) {
        // LLM 失败后，全部标记为未分析，但保留原始事件
        for (const event of events) {
          event.llmAnalyzed = false;
          event.llmImpactScore = null;
        }
        console.warn("[News] LLM analysis failed, events kept raw:", llmErr instanceof Error ? llmErr.message : llmErr);
      }
    }

    const llmCount = events.filter((e) => e.llmAnalyzed).length;
    const detail = llmCount > 0
      ? `${events.length} articles (${llmCount} LLM-analyzed)`
      : `${events.length} articles from NewsNow`;

    cachedResult = { events, status: "ok", detail };
    lastFetchTime = now;
    return cachedResult;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "NewsNow API fetch failed";
    cachedResult = { events: [], status: "error", detail: reason };
    lastFetchTime = now;
    return cachedResult;
  }
}

function guessCategory(title: string): string {
  if (title.includes("美联储") || title.includes("鲍曼") || title.includes("鲍威尔") || title.includes("FOMC") || title.includes("降息") || title.includes("加息") || title.includes("联储")) {
    return "美联储";
  }
  if (title.includes("CPI") || title.includes("通胀") || title.includes("PCE") || title.includes("物价") || title.includes("调和CPI")) {
    return "通胀";
  }
  if (title.includes("美元") || title.includes("美指") || title.includes("汇率")) {
    return "美元";
  }
  if (title.includes("美债") || title.includes("国债") || title.includes("收益率")) {
    return "美债";
  }
  if (title.includes("金") || title.includes("购金") || title.includes("黄金") || title.includes("贵金属")) {
    return "黄金市场";
  }
  if (title.includes("冲突") || title.includes("地缘") || title.includes("以色列") || title.includes("乌克兰") || title.includes("伊朗") || title.includes("战争") || title.includes("局势") || title.includes("战事")) {
    return "地缘政治";
  }
  return "宏观经济";
}

function parseNewsDate(val: string | undefined): string {
  if (!val) return new Date().toISOString();
  let str = String(val).trim();
  
  // Check if it's a Unix timestamp (seconds or milliseconds)
  if (/^\d+$/.test(str)) {
    const num = Number(str);
    const ms = num < 50000000000 ? num * 1000 : num;
    return new Date(ms).toISOString();
  }

  // If timezone-less, parse as Beijing Time (+08:00)
  if (!str.endsWith("Z") && !/[+-]\d{2}(:?\d{2})?$/.test(str)) {
    str = str.replace(" ", "T") + "+08:00";
  }

  const date = new Date(str);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function toEventRaw(item: NewsNowItem, sourceName: string): NewsEvent {
  const title = item.title.trim();
  const category = guessCategory(title);

  return {
    id: crypto.createHash("sha1").update(item.url || title).digest("hex"),
    time: parseNewsDate(item.pubDate || item.time),
    source: sourceName,
    title,
    category,
    direction: "neutral",
    impact: 0,
    summary: title,
    url: item.url,
    llmAnalyzed: false
  };
}

export function updateNewsEventCache(updatedEvent: NewsEvent) {
  if (cachedResult && cachedResult.events) {
    const idx = cachedResult.events.findIndex((e) => e.id === updatedEvent.id);
    if (idx !== -1) {
      cachedResult.events[idx] = { ...updatedEvent };
    }
  }
}
