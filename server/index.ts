import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { buildDashboard, derivedQuotes } from "./analytics.js";
import { saveEvents, saveQuotes } from "./db.js";
import { fetchAu9999 } from "./providers/au9999.js";
import { fetchNewsEvents } from "./providers/news.js";
import { fetchOandaQuotes } from "./providers/oanda.js";
import type { CandlePoint, DashboardPayload, NewsEvent, Quote } from "./types.js";

let latest: DashboardPayload | null = null;

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (existsSync(distDir)) {
  await app.register(fastifyStatic, { root: distDir, wildcard: false });
}

app.get("/api/health", async () => ({ ok: true, updatedAt: latest?.updatedAt ?? null }));
app.get("/api/dashboard", async () => latest ?? (await refresh()));
app.get("/api/settings", async () => ({
  oanda: {
    configured: Boolean(config.oandaToken),
    env: config.oandaEnv
  },
  au9999: {
    configured: Boolean(config.aktoolsBaseUrl),
    provider: "AKTools"
  },
  news: {
    provider: "GDELT",
    query: config.newsQuery
  },
  storage: {
    databasePath: config.databasePath
  }
}));

app.setNotFoundHandler((request, reply) => {
  if (request.raw.url?.startsWith("/api")) {
    reply.status(404).send({ error: "Not found" });
    return;
  }
  if (existsSync(distDir)) {
    reply.sendFile("index.html");
    return;
  }
  reply.status(404).send({ error: "Frontend build not found. Run bun run dev:web or bun run build." });
});

const sseClients = new Set<any>();

app.get("/api/stream", (request, reply) => {
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.statusCode = 200;

  // Send retry interval instruction to client (3 seconds)
  reply.raw.write("retry: 3000\n\n");

  if (latest) {
    const liveCandle = latest.candles[latest.candles.length - 1] ?? null;
    const updatePayload = {
      quotes: latest.quotes,
      liveCandle,
      sentiment: latest.sentiment,
      sources: latest.sources,
      updatedAt: latest.updatedAt
    };
    reply.raw.write(`data: ${JSON.stringify({ type: "update", payload: updatePayload })}\n\n`);
  }

  sseClients.add(reply.raw);

  request.raw.on("close", () => {
    sseClients.delete(reply.raw);
  });
});

const server = await app.listen({ port: config.port, host: "0.0.0.0" });

await refresh();
setInterval(() => {
  refresh().catch((error) => app.log.error(error));
}, config.refreshIntervalMs);

async function refresh() {
  const [oanda, au9999, news] = await Promise.all([fetchOandaQuotes(), fetchAu9999(), fetchNewsEvents()]);
  const quotes = derivedQuotes([...oanda.quotes, au9999]);
  saveQuotes(quotes);
  saveEvents(news.events);

  const mergedCandles = mergeAu9999IntoCandles(oanda.candles, au9999);
  const updatedCandles = applyEventSentiment(mergedCandles, news.events);

  latest = buildDashboard({
    quotes,
    candles: updatedCandles,
    events: news.events,
    sources: [
      { name: "XAU/USD", status: oanda.status, detail: oanda.detail },
      { name: "USD/CNH", status: oanda.status, detail: oanda.detail },
      { name: "AU9999", status: au9999.status, detail: au9999.error ?? au9999.source },
      { name: "News", status: news.status, detail: news.detail },
      { name: "Database", status: "ok", detail: config.databasePath }
    ],
    updatedAt: new Date().toISOString()
  });

  const liveCandle = updatedCandles[updatedCandles.length - 1] ?? null;
  const updatePayload = {
    quotes: latest.quotes,
    liveCandle,
    sentiment: latest.sentiment,
    sources: latest.sources,
    updatedAt: latest.updatedAt
  };

  const message = `data: ${JSON.stringify({ type: "update", payload: updatePayload })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
  return latest;
}

function mergeAu9999IntoCandles(candles: CandlePoint[], auQuote: Quote): CandlePoint[] {
  if (!auQuote.history || !auQuote.history.length) return candles;

  const sortedPoints = [...auQuote.history]
    .filter((p) => p.updatedAt)
    .sort((a, b) => new Date(a.updatedAt!).getTime() - new Date(b.updatedAt!).getTime());

  if (!sortedPoints.length) return candles;

  let pointIndex = 0;
  let lastPrice: number | null = null;

  return candles.map((candle) => {
    const candleTime = new Date(candle.time).getTime();

    while (
      pointIndex < sortedPoints.length &&
      new Date(sortedPoints[pointIndex].updatedAt!).getTime() <= candleTime
    ) {
      lastPrice = sortedPoints[pointIndex].price;
      pointIndex++;
    }

    return {
      ...candle,
      au9999: lastPrice
    };
  });
}

function applyEventSentiment(candles: CandlePoint[], events: NewsEvent[]) {
  if (!candles.length || !events.length) return candles.map((candle) => ({ ...candle, sentiment: 0 }));

  const orderedCandles = candles.map((candle) => ({ ...candle, sentiment: 0 }));
  const candleTimes = orderedCandles.map((candle) => new Date(candle.time).getTime());

  for (const event of events) {
    const eventTime = new Date(event.time).getTime();
    if (!Number.isFinite(eventTime)) continue;

    let targetIndex = -1;
    for (let index = candleTimes.length - 1; index >= 0; index -= 1) {
      if (eventTime >= candleTimes[index]) {
        targetIndex = index;
        break;
      }
    }

    if (targetIndex >= 0) {
      const current = orderedCandles[targetIndex].sentiment;
      orderedCandles[targetIndex].sentiment = Math.max(-100, Math.min(100, current + event.impact));
    }
  }

  return orderedCandles;
}

app.log.info(`Aurum Watch API listening on ${server}`);
