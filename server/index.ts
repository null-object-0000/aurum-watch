import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { buildDashboard, derivedQuotes } from "./analytics.js";
import {
  saveEvents,
  saveQuotes,
  saveTick,
  cleanOldTicks,
  aggregateTicksToMinute,
  getRecentTicks,
  getAggregatedCandles,
  supplementHistoryPrice,
  bulkSaveHistoryMinutes,
  clearHistoryMinutesForSymbol,
  clearAllHistoryMinutes,
  clearEventsInDb,
  clearQuotesInDb,
  deleteEventFromDb,
  deleteQuoteFromDb,
  getAllEventsFromDb,
  getDatasetStats,
  getInitStatus,
  exportAllData,
  importAllData,
  getHistoryMinutesRange,
  getHistoryMinutesCount,
  getHistoryDays,
  getDailyCoverage,
  getMonthlyCoverage
} from "./db.js";
import { fetchAu9999 } from "./providers/au9999.js";
import { fetchNewsEvents } from "./providers/news.js";
import {
  fetchOandaQuotes,
  fetchOandaCandles,
  fetchOandaCandlesForDay
} from "./providers/oanda.js";
import type { CandlePoint, DashboardPayload, NewsEvent, Quote } from "./types.js";

// ─── State ────────────────────────────────────────────────────────────────

let latest: DashboardPayload | null = null;
let lastMinute = getCurrentMinuteISO();

// ─── Sync Job ─────────────────────────────────────────────────────────────

interface SyncJob {
  status: "running" | "done" | "error";
  datasetId: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  completedDays: number;
  currentDay: string | null;
  error: string | null;
  startedAt: string;
}

let currentSyncJob: SyncJob | null = null;

// ─── App Setup ────────────────────────────────────────────────────────────

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.addHook("onSend", async (request, reply) => {
  if (request.raw.url?.startsWith("/api/")) {
    reply.header("Cache-Control", "no-store");
  }
});

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (existsSync(distDir)) {
  await app.register(fastifyStatic, { root: distDir, wildcard: false });
}

// ─── Core API ─────────────────────────────────────────────────────────────

app.get("/api/health", async () => ({ ok: true, updatedAt: latest?.updatedAt ?? null }));

app.get("/api/dashboard", async () => latest ?? (await refresh()));

app.get("/api/init-status", async () => getInitStatus());

app.get("/api/settings", async () => ({
  oanda: { configured: Boolean(config.oandaToken), env: config.oandaEnv },
  au9999: { configured: Boolean(config.aktoolsBaseUrl), provider: "AKTools" },
  news: { provider: "GDELT", query: config.newsQuery },
  storage: { databasePath: config.databasePath }
}));

// ─── Candles ──────────────────────────────────────────────────────────────

const RANGE_CONFIG = {
  "1H":  { intervalSeconds: 60,    lookbackHours: 1   },
  "4H":  { intervalSeconds: 300,   lookbackHours: 4   },
  "1D":  { intervalSeconds: 900,   lookbackHours: 24  },
  "7D":  { intervalSeconds: 3600,  lookbackHours: 168 },
  "30D": { intervalSeconds: 14400, lookbackHours: 720 }
} as const;

app.get("/api/candles", async (request, reply) => {
  const query = request.query as { range?: string };
  const range = (query.range ?? "1D") as keyof typeof RANGE_CONFIG;
  if (!Object.keys(RANGE_CONFIG).includes(range)) {
    reply.status(400).send({ error: "Invalid range parameter" });
    return;
  }
  try {
    return await buildCandles(range);
  } catch (error) {
    app.log.error(error);
    reply.status(500).send({ error: error instanceof Error ? error.message : "Failed to fetch candles" });
  }
});

async function buildCandles(range: keyof typeof RANGE_CONFIG): Promise<CandlePoint[]> {
  const { intervalSeconds, lookbackHours } = RANGE_CONFIG[range];
  const afterTime = new Date(Date.now() - lookbackHours * 3600_000).toISOString();
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();

  const [xauHistory, au9999History] = await Promise.all([
    getAggregatedCandles("XAU_USD", afterTime, intervalSeconds),
    getAggregatedCandles("AU9999", afterTime, intervalSeconds)
  ]);

  const timeMap = new Map<string, CandlePoint>();

  for (const row of xauHistory) {
    timeMap.set(row.time, { time: row.time, xauUsd: row.price, au9999: null, sentiment: 0 });
  }
  for (const row of au9999History) {
    const c = timeMap.get(row.time) ?? { time: row.time, xauUsd: null, au9999: null, sentiment: 0 };
    timeMap.set(row.time, { ...c, au9999: row.price });
  }

  const recentXauTicks = getRecentTicks("XAU_USD", oneHourAgo);
  const recentAuTicks  = getRecentTicks("AU9999",  oneHourAgo);
  aggregateTicksIntoMap(recentXauTicks, intervalSeconds, timeMap, "xauUsd");
  aggregateTicksIntoMap(recentAuTicks,  intervalSeconds, timeMap, "au9999");

  const events = latest?.events ?? getAllEventsFromDb();
  const sorted = Array.from(timeMap.values()).sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
  );
  return applyEventSentiment(sorted, events);
}

function aggregateTicksIntoMap(
  ticks: Array<{ time: string; price: number }>,
  intervalSeconds: number,
  map: Map<string, CandlePoint>,
  field: "xauUsd" | "au9999"
) {
  for (const tick of ticks) {
    const slotTime = alignToSlot(tick.time, intervalSeconds);
    const existing = map.get(slotTime) ?? { time: slotTime, xauUsd: null, au9999: null, sentiment: 0 };
    map.set(slotTime, { ...existing, [field]: tick.price });
  }
}

// ─── SSE ──────────────────────────────────────────────────────────────────

const sseClients = new Set<any>();

app.get("/api/stream", (request, reply) => {
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.statusCode = 200;
  reply.raw.write("retry: 3000\n\n");
  sseClients.add(reply.raw);
  request.raw.on("close", () => sseClients.delete(reply.raw));
});

function broadcast(type: string, payload: unknown) {
  const message = `data: ${JSON.stringify({ type, payload })}\n\n`;
  for (const client of sseClients) {
    try { client.write(message); } catch { sseClients.delete(client); }
  }
}

function broadcastUpdate() {
  if (!latest) return;
  broadcast("update", {
    quotes: latest.quotes,
    liveCandle: latest.candles[latest.candles.length - 1] ?? null,
    sentiment: latest.sentiment,
    sources: latest.sources,
    updatedAt: latest.updatedAt
  });
}

// ─── Not Found ────────────────────────────────────────────────────────────

app.setNotFoundHandler((request, reply) => {
  if (request.raw.url?.startsWith("/api")) {
    reply.status(404).send({ error: "Not found" });
    return;
  }
  if (existsSync(distDir)) {
    reply.sendFile("index.html");
    return;
  }
  reply.status(404).send({ error: "Frontend build not found." });
});

// ─── Settings / Data Management API ──────────────────────────────────────

app.get("/api/settings/data", async () => {
  const stats = getDatasetStats();
  const initStatus = getInitStatus();
  return {
    database: {
      path: config.databasePath,
      sizeBytes: initStatus.dbSizeBytes,
      sizeMb: (initStatus.dbSizeBytes / 1024 / 1024).toFixed(2)
    },
    datasets: stats
  };
});

// ── Coverage calendar ─────────────────────────────────────────────────────

app.get("/api/settings/data/coverage", async (request, reply) => {
  const q = request.query as { symbol?: string; year?: string; month?: string };
  const symbol = q.symbol ?? "XAU_USD";
  const year = parseInt(q.year ?? String(new Date().getFullYear()), 10);

  if (q.month) {
    const month = parseInt(q.month, 10);
    return getDailyCoverage(symbol, year, month);
  }
  return getMonthlyCoverage(symbol, year);
});

// ── Manual fetch / clear ──────────────────────────────────────────────────

app.post("/api/settings/data/fetch", async (request, reply) => {
  const body = request.body as { datasetId?: string };
  const datasetId = body?.datasetId ?? "all";
  try {
    await fetchAndSyncDataset(datasetId);
    await refresh();
    return { ok: true, datasetId };
  } catch (error) {
    reply.status(500).send({ error: error instanceof Error ? error.message : "Fetch failed" });
  }
});

app.post("/api/settings/data/clear", async (request, reply) => {
  const body = request.body as { datasetId?: string };
  const datasetId = body?.datasetId ?? "all";
  try {
    switch (datasetId) {
      case "XAU_USD": clearHistoryMinutesForSymbol("XAU_USD"); deleteQuoteFromDb("XAU_USD"); break;
      case "AU9999":  clearHistoryMinutesForSymbol("AU9999");  deleteQuoteFromDb("AU9999");  break;
      case "USD_CNH": clearHistoryMinutesForSymbol("USD_CNH"); deleteQuoteFromDb("USD_CNH"); break;
      case "NEWS":    clearEventsInDb(); break;
      case "all":
        clearAllHistoryMinutes();
        clearQuotesInDb();
        clearEventsInDb();
        break;
      default:
        reply.status(400).send({ error: "Invalid datasetId" });
        return;
    }
    await refresh();
    return { ok: true, datasetId };
  } catch (error) {
    reply.status(500).send({ error: error instanceof Error ? error.message : "Clear failed" });
  }
});

// ── Date Range Sync ───────────────────────────────────────────────────────

app.get("/api/settings/data/sync-status", async () => {
  if (!currentSyncJob) return { status: "idle" };
  return currentSyncJob;
});

app.post("/api/settings/data/sync-range", async (request, reply) => {
  const body = request.body as {
    datasetId: "XAU_USD" | "USD_CNH" | "all";
    startDate: string; // "YYYY-MM-DD"
    endDate: string;   // "YYYY-MM-DD"
  };

  if (!body?.startDate || !body?.endDate) {
    reply.status(400).send({ error: "Missing startDate or endDate" });
    return;
  }
  if (currentSyncJob?.status === "running") {
    reply.status(409).send({ error: "已有同步任务正在运行，请稍后再试" });
    return;
  }

  const days = buildDateRange(body.startDate, body.endDate);
  currentSyncJob = {
    status: "running",
    datasetId: body.datasetId ?? "all",
    startDate: body.startDate,
    endDate: body.endDate,
    totalDays: days.length,
    completedDays: 0,
    currentDay: null,
    error: null,
    startedAt: new Date().toISOString()
  };

  // Return immediately — run sync in background
  reply.send({ ok: true, totalDays: days.length });

  runDateRangeSync(body.datasetId ?? "all", days).catch((err) => {
    if (currentSyncJob) {
      currentSyncJob.status = "error";
      currentSyncJob.error = err instanceof Error ? err.message : "Unknown error";
      broadcast("sync-progress", currentSyncJob);
    }
  });
});

async function runDateRangeSync(datasetId: string, days: string[]) {
  if (!currentSyncJob) return;

  for (const day of days) {
    currentSyncJob.currentDay = day;
    broadcast("sync-progress", { ...currentSyncJob });

    const rows: Array<{ symbol: string; price: number; time: string }> = [];

    if (datasetId === "XAU_USD" || datasetId === "all") {
      const candles = await fetchOandaCandlesForDay("XAU_USD", day);
      for (const c of candles) {
        rows.push({ symbol: "XAU_USD", price: Number(c.mid.c), time: c.time });
      }
    }
    if (datasetId === "USD_CNH" || datasetId === "all") {
      const candles = await fetchOandaCandlesForDay("USD_CNH", day);
      for (const c of candles) {
        rows.push({ symbol: "USD_CNH", price: Number(c.mid.c), time: c.time });
      }
    }

    if (rows.length) bulkSaveHistoryMinutes(rows);

    currentSyncJob.completedDays++;
    broadcast("sync-progress", { ...currentSyncJob });

    // Small throttle to avoid hammering OANDA API
    await new Promise((r) => setTimeout(r, 150));
  }

  currentSyncJob.status = "done";
  currentSyncJob.currentDay = null;
  broadcast("sync-progress", { ...currentSyncJob });

  // Rebuild dashboard after sync
  await refresh();
}

// ── Supplement ────────────────────────────────────────────────────────────

app.post("/api/settings/data/supplement", async (request, reply) => {
  const body = request.body as {
    type: "event";
    time?: string;
    source?: string;
    title?: string;
    category?: string;
    direction?: string;
    impact?: number;
    summary?: string;
    url?: string;
  };

  if (!body?.type || !body.time) {
    reply.status(400).send({ error: "Missing required fields: type, time" });
    return;
  }

  try {
    if (body.type === "event") {
      if (!body.title) {
        reply.status(400).send({ error: "Event supplement requires title" });
        return;
      }
      const crypto = await import("node:crypto");
      const event: NewsEvent = {
        id: crypto.createHash("sha1").update(body.title + body.time).digest("hex"),
        time: body.time,
        source: body.source ?? "手动补录",
        title: body.title,
        category: body.category ?? "黄金市场",
        direction: (body.direction as any) ?? "neutral",
        impact: body.impact ?? 0,
        summary: body.summary ?? body.title,
        url: body.url
      };
      saveEvents([event]);
    } else {
      reply.status(400).send({ error: "Invalid type" });
      return;
    }

    await refresh();
    return { ok: true };
  } catch (error) {
    reply.status(500).send({ error: error instanceof Error ? error.message : "Supplement failed" });
  }
});

app.delete("/api/settings/data/events/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    deleteEventFromDb(id);
    await refresh();
    return { ok: true, id };
  } catch (error) {
    reply.status(500).send({ error: error instanceof Error ? error.message : "Delete failed" });
  }
});

app.get("/api/settings/data/export", async (_request, reply) => {
  const data = exportAllData();
  reply.header("Content-Type", "application/json");
  reply.header("Content-Disposition", `attachment; filename="aurum-watch-backup-${Date.now()}.json"`);
  return data;
});

app.post("/api/settings/data/import", async (request, reply) => {
  const body = request.body as Parameters<typeof importAllData>[0];
  try {
    importAllData(body);
    await refresh();
    return { ok: true };
  } catch (error) {
    reply.status(500).send({ error: error instanceof Error ? error.message : "Import failed" });
  }
});

// ─── Init Sync ────────────────────────────────────────────────────────────

app.post("/api/init/sync", async (_request, reply) => {
  try {
    const [oanda, au9999, news] = await Promise.all([fetchOandaQuotes(), fetchAu9999(), fetchNewsEvents()]);
    saveQuotes(derivedQuotes([...oanda.quotes, au9999]));
    saveEvents(news.events);
    await refresh();
    return { ok: true, initialized: true };
  } catch (error) {
    reply.status(500).send({ error: error instanceof Error ? error.message : "Sync failed" });
  }
});

// ─── Data Fetch Helpers ───────────────────────────────────────────────────

async function fetchAndSyncDataset(datasetId: string) {
  switch (datasetId) {
    case "XAU_USD":
    case "USD_CNH": {
      const result = await fetchOandaQuotes();
      saveQuotes(result.quotes);
      const q = result.quotes.find((q) => q.symbol === datasetId);
      if (q?.value) saveTick(datasetId, q.value, new Date().toISOString());
      break;
    }
    case "AU9999": {
      const au = await fetchAu9999();
      saveQuotes([au]);
      if (au.value) saveTick("AU9999", au.value, new Date().toISOString());
      break;
    }
    case "NEWS": {
      const news = await fetchNewsEvents();
      saveEvents(news.events);
      break;
    }
    case "all": {
      const [oanda, au9999, news] = await Promise.all([fetchOandaQuotes(), fetchAu9999(), fetchNewsEvents()]);
      const quotes = derivedQuotes([...oanda.quotes, au9999]);
      saveQuotes(quotes);
      saveEvents(news.events);
      for (const q of quotes) {
        if (q.value && ["XAU_USD", "AU9999", "USD_CNH"].includes(q.symbol)) {
          saveTick(q.symbol, q.value, new Date().toISOString());
        }
      }
      break;
    }
  }
}

// ─── Start Server ─────────────────────────────────────────────────────────

const server = await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info(`Aurum Watch API listening on ${server}`);

// Initial refresh
await refresh();

// Auto background sync if history_minutes is empty and OANDA configured
const { historyMinutesCount } = getInitStatus();
if (historyMinutesCount === 0 && config.oandaToken) {
  app.log.info("history_minutes empty — starting background 90-day sync...");
  const endDate = toDateStr(new Date());
  const startDate = toDateStr(new Date(Date.now() - 90 * 86_400_000));
  const days = buildDateRange(startDate, endDate);
  currentSyncJob = {
    status: "running",
    datasetId: "all",
    startDate,
    endDate,
    totalDays: days.length,
    completedDays: 0,
    currentDay: null,
    error: null,
    startedAt: new Date().toISOString()
  };
  runDateRangeSync("all", days).catch((err) => app.log.error("Auto sync failed:", err));
}

// Per-second tick timer
setInterval(() => {
  tickRefresh().catch((err) => app.log.error(err));
}, 1000);

// Full refresh every N seconds (quotes + news)
setInterval(() => {
  refresh().catch((err) => app.log.error(err));
}, config.refreshIntervalMs);

// ─── Refresh Logic ────────────────────────────────────────────────────────

async function tickRefresh() {
  const [oanda, au9999] = await Promise.all([fetchOandaQuotes(), fetchAu9999()]);
  const now = new Date().toISOString();

  for (const q of [...oanda.quotes, au9999]) {
    if (q.value !== null && ["XAU_USD", "AU9999", "USD_CNH"].includes(q.symbol)) {
      saveTick(q.symbol, q.value, now);
    }
  }

  const currentMinute = getCurrentMinuteISO();
  if (currentMinute !== lastMinute) {
    aggregateTicksToMinute(lastMinute);
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    cleanOldTicks(oneHourAgo);
    lastMinute = currentMinute;
  }

  if (latest) {
    const quotes = derivedQuotes([...oanda.quotes, au9999]);
    latest = { ...latest, quotes, updatedAt: now };
    broadcastUpdate();
  }
}

async function refresh() {
  const [oanda, au9999, news] = await Promise.all([fetchOandaQuotes(), fetchAu9999(), fetchNewsEvents()]);
  const quotes = derivedQuotes([...oanda.quotes, au9999]);
  saveQuotes(quotes);
  saveEvents(news.events);

  for (const q of quotes) {
    if (q.value !== null && ["XAU_USD", "AU9999", "USD_CNH"].includes(q.symbol)) {
      saveTick(q.symbol, q.value, new Date().toISOString());
    }
  }

  const candles = await buildCandles("1D").catch(() => []);

  latest = buildDashboard({
    quotes,
    candles,
    events: news.events,
    sources: [
      { name: "XAU/USD",   status: oanda.status,  detail: oanda.detail },
      { name: "USD/CNH",   status: oanda.status,  detail: oanda.detail },
      { name: "AU9999",    status: au9999.status,  detail: au9999.error ?? au9999.source },
      { name: "News",      status: news.status,    detail: news.detail },
      { name: "Database",  status: "ok",           detail: config.databasePath }
    ],
    updatedAt: new Date().toISOString()
  });

  broadcastUpdate();
  return latest;
}

// ─── Utility Functions ────────────────────────────────────────────────────

function getCurrentMinuteISO(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString();
}

function alignToSlot(isoTime: string, intervalSeconds: number): string {
  const epochSec = Math.floor(new Date(isoTime).getTime() / 1000);
  const slotSec = Math.floor(epochSec / intervalSeconds) * intervalSeconds;
  return new Date(slotSec * 1000).toISOString();
}

function applyEventSentiment(candles: CandlePoint[], events: NewsEvent[]): CandlePoint[] {
  if (!candles.length || !events.length) return candles.map((c) => ({ ...c, sentiment: 0 }));

  const result = candles.map((c) => ({ ...c, sentiment: 0 }));
  const times = result.map((c) => new Date(c.time).getTime());

  for (const event of events) {
    const eventTime = new Date(event.time).getTime();
    if (!Number.isFinite(eventTime)) continue;
    let targetIndex = -1;
    for (let i = times.length - 1; i >= 0; i--) {
      if (eventTime >= times[i]) { targetIndex = i; break; }
    }
    if (targetIndex >= 0) {
      result[targetIndex].sentiment = Math.max(
        -100,
        Math.min(100, result[targetIndex].sentiment + event.impact)
      );
    }
  }
  return result;
}

/** 生成从 startDate 到 endDate（含）的日期字符串数组，格式 "YYYY-MM-DD" */
function buildDateRange(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const current = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (current <= end) {
    days.push(toDateStr(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
