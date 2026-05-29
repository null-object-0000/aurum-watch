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
  getAllQuotesFromDb,
  getDatasetStats,
  getInitStatus,
  exportAllData,
  importAllData,
  getDailyCoverage,
  getMonthlyCoverage,
  getEventsCount
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

function isSyncRunning() {
  return currentSyncJob?.status === "running";
}

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

app.get("/api/dashboard", async () => latest ?? (await buildDashboardSnapshot()));

app.get("/api/init-status", async () => {
  const aktools = await checkAktoolsHealth();
  return { ...getInitStatus(), au9999Reachable: aktools.reachable, aktoolsVersion: aktools.version, aktoolsError: aktools.error };
});

app.get("/api/settings", async () => {
  const aktools = await checkAktoolsHealth();
  return {
    oanda: { configured: Boolean(config.oandaToken), env: config.oandaEnv },
    au9999: { configured: Boolean(config.aktoolsBaseUrl), provider: "AKTools", ...aktools },
    news: { provider: "GDELT", query: config.newsQuery },
    storage: { databasePath: config.databasePath }
  };
});

// ─── Candles ──────────────────────────────────────────────────────────────

const RANGE_CONFIG = {
  "1H":  { intervalSeconds: 60,     lookbackHours: 1   },
  "4H":  { intervalSeconds: 300,    lookbackHours: 4   },
  "1D":  { intervalSeconds: 900,    lookbackHours: 24  },
  "7D":  { intervalSeconds: 7200,   lookbackHours: 168 },
  "30D": { intervalSeconds: 21600,  lookbackHours: 720 }
} as const;

app.get("/api/candles", async (request, reply) => {
  const query = request.query as { range?: string; tzOffset?: string };
  const range = (query.range ?? "1D") as keyof typeof RANGE_CONFIG;
  if (!Object.keys(RANGE_CONFIG).includes(range)) {
    reply.status(400).send({ error: "Invalid range parameter" });
    return;
  }
  const timezoneOffsetMinutes = Number(query.tzOffset ?? 0);
  if (!Number.isFinite(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 14 * 60) {
    reply.status(400).send({ error: "Invalid timezone offset" });
    return;
  }
  try {
    return await buildCandles(range, timezoneOffsetMinutes);
  } catch (error) {
    app.log.error(error);
    reply.status(500).send({ error: error instanceof Error ? error.message : "Failed to fetch candles" });
  }
});

async function buildCandles(range: keyof typeof RANGE_CONFIG, timezoneOffsetMinutes = 0): Promise<CandlePoint[]> {
  const { intervalSeconds, lookbackHours } = RANGE_CONFIG[range];
  const afterTime = new Date(Date.now() - lookbackHours * 3600_000).toISOString();
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();

  const [xauHistory, au9999History] = await Promise.all([
    getAggregatedCandles("XAU_USD", afterTime, intervalSeconds, timezoneOffsetMinutes),
    getAggregatedCandles("AU9999", afterTime, intervalSeconds, timezoneOffsetMinutes)
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
  if (isSyncRunning()) {
    reply.status(409).send({ error: "已有同步任务正在运行，请稍后再试" });
    return;
  }
  const body = request.body as { datasetId?: string };
  const datasetId = body?.datasetId ?? "all";
  try {
    await fetchAndSyncDataset(datasetId);
    await refreshLiveData();
    return { ok: true, datasetId };
  } catch (error) {
    reply.status(500).send({ error: error instanceof Error ? error.message : "Fetch failed" });
  }
});

app.post("/api/settings/data/clear", async (request, reply) => {
  if (isSyncRunning()) {
    reply.status(409).send({ error: "已有同步任务正在运行，请稍后再试" });
    return;
  }
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
    await refreshLiveData();
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

  const validation = validateSyncRequest(body);
  if (!validation.ok) {
    reply.status(400).send({ error: validation.error });
    return;
  }
  if (currentSyncJob?.status === "running") {
    reply.status(409).send({ error: "已有同步任务正在运行，请稍后再试" });
    return;
  }

  const datasetId = body.datasetId ?? "all";
  const days = buildDateRange(body.startDate, body.endDate);
  currentSyncJob = {
    status: "running",
    datasetId,
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

  runDateRangeSync(datasetId, days).catch((err) => {
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

    const symbols: Array<"XAU_USD" | "USD_CNH"> =
      datasetId === "all"
        ? ["XAU_USD", "USD_CNH"]
        : datasetId === "XAU_USD" || datasetId === "USD_CNH"
          ? [datasetId]
          : [];

    const results = await Promise.all(
      symbols.map(async (symbol) => ({
        symbol,
        candles: await fetchOandaCandlesForDay(symbol, day)
      }))
    );

    for (const result of results) {
      for (const candle of result.candles) {
        rows.push({ symbol: result.symbol, price: Number(candle.mid.c), time: candle.time });
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

  // Rebuild dashboard from the database after sync.
  latest = await buildDashboardSnapshot();
  broadcastUpdate();
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

    await refreshLiveData();
    return { ok: true };
  } catch (error) {
    reply.status(500).send({ error: error instanceof Error ? error.message : "Supplement failed" });
  }
});

app.delete("/api/settings/data/events/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    deleteEventFromDb(id);
    await refreshLiveData();
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
  if (isSyncRunning()) {
    reply.status(409).send({ error: "已有同步任务正在运行，请稍后再试" });
    return;
  }
  const body = request.body as Parameters<typeof importAllData>[0];
  try {
    importAllData(body);
    await refreshLiveData();
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
      await refreshLiveData();
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
await refreshLiveData();

// Per-second tick timer
setInterval(() => {
  tickRefresh().catch((err) => app.log.error(err));
}, 1000);

// Full refresh every N seconds (quotes + news)
setInterval(() => {
  refreshLiveData().catch((err) => app.log.error(err));
}, config.refreshIntervalMs);

// ─── Refresh Logic ────────────────────────────────────────────────────────

async function tickRefresh() {
  const [oanda, au9999] = await Promise.all([fetchOandaQuotes(), fetchAu9999()]);
  const now = new Date().toISOString();
  const quotes = derivedQuotes([...oanda.quotes, au9999]);
  saveQuotes(quotes);

  for (const q of quotes) {
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

  latest = await buildDashboardSnapshot();
  broadcastUpdate();
}

async function refreshLiveData() {
  const [oanda, au9999, news] = await Promise.all([fetchOandaQuotes(), fetchAu9999(), fetchNewsEvents()]);
  const quotes = derivedQuotes([...oanda.quotes, au9999]);
  saveQuotes(quotes);
  saveEvents(news.events);

  for (const q of quotes) {
    if (q.value !== null && ["XAU_USD", "AU9999", "USD_CNH"].includes(q.symbol)) {
      saveTick(q.symbol, q.value, new Date().toISOString());
    }
  }

  latest = await buildDashboardSnapshot({
    oandaDetail: oanda.detail,
    newsDetail: news.detail,
    newsStatus: news.status
  });
  broadcastUpdate();
  return latest;
}

async function buildDashboardSnapshot(options?: { oandaDetail?: string; newsDetail?: string; newsStatus?: Quote["status"] }) {
  const quotes = getAllQuotesFromDb();
  const events = getAllEventsFromDb();
  const candles = await buildCandles("1D").catch(() => []);
  const xau = quotes.find((q) => q.symbol === "XAU_USD");
  const cnh = quotes.find((q) => q.symbol === "USD_CNH");
  const au = quotes.find((q) => q.symbol === "AU9999");
  const newsCount = getEventsCount();

  latest = buildDashboard({
    quotes,
    candles,
    events,
    sources: [
      sourceFromQuote("XAU/USD", xau, options?.oandaDetail ?? xau?.source ?? "OANDA"),
      sourceFromQuote("USD/CNH", cnh, options?.oandaDetail ?? cnh?.source ?? "OANDA"),
      sourceFromQuote("AU9999", au, au?.error ?? au?.source ?? "AKTools/SGE"),
      { name: "News", status: options?.newsStatus ?? (newsCount > 0 ? "ok" : "stale"), detail: options?.newsDetail ?? `${newsCount} cached events` },
      { name: "Database", status: "ok", detail: config.databasePath }
    ],
    updatedAt: new Date().toISOString()
  });
  return latest;
}

function sourceFromQuote(name: string, quote: Quote | undefined, detail: string) {
  return {
    name,
    status: quote?.status ?? "unconfigured",
    detail: quote?.error ?? detail
  };
}

// ─── Utility Functions ────────────────────────────────────────────────────

function validateSyncRequest(body: {
  datasetId?: string;
  startDate?: string;
  endDate?: string;
}): { ok: true } | { ok: false; error: string } {
  if (!body?.startDate || !body?.endDate) return { ok: false, error: "Missing startDate or endDate" };
  if (!["all", "XAU_USD", "USD_CNH"].includes(body.datasetId ?? "all")) {
    return { ok: false, error: "Invalid datasetId" };
  }
  if (!isDateOnly(body.startDate) || !isDateOnly(body.endDate)) {
    return { ok: false, error: "日期格式必须为 YYYY-MM-DD" };
  }
  const start = new Date(`${body.startDate}T00:00:00Z`);
  const end = new Date(`${body.endDate}T00:00:00Z`);
  const today = new Date(`${toDateStr(new Date())}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return { ok: false, error: "日期无效" };
  }
  if (start > end) return { ok: false, error: "开始日期不能晚于结束日期" };
  if (end > today) return { ok: false, error: "结束日期不能晚于今天" };
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days < 1 || days > 365) return { ok: false, error: "同步范围必须在 1 到 365 天之间" };
  return { ok: true };
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function checkAktoolsHealth(): Promise<{ reachable: boolean; version: string | null; error: string | null }> {
  if (!config.aktoolsBaseUrl) return { reachable: false, version: null, error: "AKTOOLS_BASE_URL is not configured" };
  try {
    const url = new URL("/version", normalizedBaseUrl(config.aktoolsBaseUrl));
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`AKTools version ${response.status}`);
    const text = await response.text();
    const payload = parseMaybeJson(text);
    const version = extractVersion(payload);
    return { reachable: true, version, error: null };
  } catch (error) {
    return {
      reachable: false,
      version: null,
      error: error instanceof Error ? error.message : "AKTools version check failed"
    };
  }
}

function extractVersion(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const aktools = record.at_current_version ?? record.aktools ?? record.aktools_version ?? record.version;
  const akshare = record.ak_current_version ?? record.akshare ?? record.akshare_version;
  if (typeof aktools === "string" && typeof akshare === "string") {
    return `AKTools ${aktools} / AKShare ${akshare}`;
  }
  const value = aktools ?? akshare;
  return typeof value === "string" ? value : null;
}

function parseMaybeJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

function normalizedBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

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
