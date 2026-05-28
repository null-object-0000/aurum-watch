import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { buildDashboard, derivedQuotes } from "./analytics.js";
import { saveEvents, saveQuotes } from "./db.js";
import { fetchAu9999 } from "./providers/au9999.js";
import { fetchNewsEvents } from "./providers/news.js";
import { fetchOandaQuotes } from "./providers/oanda.js";
import type { CandlePoint, DashboardPayload, NewsEvent } from "./types.js";

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

const server = await app.listen({ port: config.port, host: "0.0.0.0" });
const wss = new WebSocketServer({ server: app.server, path: "/ws" });

wss.on("connection", (socket) => {
  if (latest) socket.send(JSON.stringify({ type: "dashboard", payload: latest }));
});

await refresh();
setInterval(() => {
  refresh().catch((error) => app.log.error(error));
}, config.refreshIntervalMs);

async function refresh() {
  const [oanda, au9999, news] = await Promise.all([fetchOandaQuotes(), fetchAu9999(), fetchNewsEvents()]);
  const quotes = derivedQuotes([...oanda.quotes, au9999]);
  saveQuotes(quotes);
  saveEvents(news.events);

  latest = buildDashboard({
    quotes,
    candles: applyEventSentiment(oanda.candles, news.events),
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

  const message = JSON.stringify({ type: "dashboard", payload: latest });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
  return latest;
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
