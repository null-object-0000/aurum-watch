import { config, oandaBaseUrl, oandaStreamUrl } from "../config.js";
import type { CandlePoint, Health, Quote } from "../types.js";

type OandaPrice = {
  instrument: string;
  time: string;
  closeoutBid: string;
  closeoutAsk: string;
};

export type OandaStreamPrice = {
  instrument: "XAU_USD" | "USD_CNH";
  price: number;
  time: string;
};

type OandaCandle = {
  time: string;
  complete: boolean;
  mid: { c: string };
};

let resolvedAccountId: string | null = null;
const candleCache = new Map<string, { updatedAt: number; candles: OandaCandle[] }>();
const CANDLE_CACHE_TTL_MS = 60_000;

const headers = () => ({
  Authorization: `Bearer ${config.oandaToken}`,
  "Content-Type": "application/json"
});

function unavailable(symbol: Quote["symbol"], label: string, unit: string, reason: string): Quote {
  return {
    symbol,
    label,
    value: null,
    change: null,
    changePct: null,
    unit,
    source: "OANDA",
    status: "unconfigured",
    updatedAt: null,
    sparkline: [],
    error: reason
  };
}

export async function fetchOandaQuotes(): Promise<{ quotes: Quote[]; candles: CandlePoint[]; status: Health; detail: string }> {
  if (!config.oandaToken) {
    return {
      quotes: [
        unavailable("XAU_USD", "XAU/USD", "USD/oz", "Set OANDA_API_TOKEN"),
        unavailable("USD_CNH", "USD/CNH", "rate", "Set OANDA_API_TOKEN")
      ],
      candles: [],
      status: "unconfigured",
      detail: "OANDA token missing"
    };
  }

  try {
    const accountId = await getAccountId();
    const instruments = "XAU_USD,USD_CNH";
    const priceUrl = `${oandaBaseUrl}/v3/accounts/${accountId}/pricing?instruments=${instruments}`;
    const [priceRes, xauCandlesRaw, cnhCandlesRaw] = await Promise.all([
      fetch(priceUrl, { headers: headers() }),
      fetchOandaCandles("XAU_USD", "M15", 2880),
      fetchOandaCandles("USD_CNH", "M15", 2880)
    ]);

    if (!priceRes.ok) throw new Error(`OANDA pricing ${priceRes.status}`);

    const priceJson = (await priceRes.json()) as { prices: OandaPrice[] };
    const xauPrice = priceJson.prices.find((p) => p.instrument === "XAU_USD");
    const cnhPrice = priceJson.prices.find((p) => p.instrument === "USD_CNH");
    const latestXau = midpoint(xauPrice);
    const latestCnh = midpoint(cnhPrice);
    const xauSeries = appendLiveValue(xauCandlesRaw, latestXau);
    const cnhSeries = appendLiveValue(cnhCandlesRaw, latestCnh);
    const previousXau = previousCompletedValue(xauCandlesRaw);
    const previousCnh = previousCompletedValue(cnhCandlesRaw);

    const xauQuote = makeQuote("XAU_USD", "XAU/USD", latestXau, previousXau, "USD/oz", "OANDA", xauSeries.slice(-120));
    const cnhQuote = makeQuote("USD_CNH", "USD/CNH", latestCnh, previousCnh, "rate", "OANDA", cnhSeries.slice(-120));

    const candles = appendLiveCandle(xauCandlesRaw, latestXau, xauPrice?.time).map((c) => ({
      time: c.time,
      xauUsd: Number(c.mid.c),
      au9999: null,
      sentiment: 0
    }));

    return { quotes: [xauQuote, cnhQuote], candles, status: "ok", detail: `OANDA connected (${accountId})` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OANDA request failed";
    return {
      quotes: [
        { ...unavailable("XAU_USD", "XAU/USD", "USD/oz", message), status: "error" },
        { ...unavailable("USD_CNH", "USD/CNH", "rate", message), status: "error" }
      ],
      candles: [],
      status: "error",
      detail: message
    };
  }
}

async function getAccountId() {
  if (resolvedAccountId) return resolvedAccountId;

  const response = await fetch(`${oandaBaseUrl}/v3/accounts`, { headers: headers() });
  if (!response.ok) throw new Error(`OANDA accounts ${response.status}`);

  const json = (await response.json()) as { accounts?: Array<{ id: string }> };
  const accountId = json.accounts?.[0]?.id;
  if (!accountId) throw new Error("OANDA returned no accounts for this token");

  resolvedAccountId = accountId;
  return accountId;
}

export async function startOandaPricingStream({
  onPrices,
  onStatus,
  signal
}: {
  onPrices: (prices: OandaStreamPrice[]) => void | Promise<void>;
  onStatus?: (status: { state: "connecting" | "connected" | "error" | "stopped"; detail: string }) => void;
  signal?: AbortSignal;
}) {
  if (!config.oandaToken) {
    onStatus?.({ state: "stopped", detail: "OANDA token missing" });
    return;
  }

  try {
    onStatus?.({ state: "connecting", detail: "Connecting to OANDA pricing stream" });
    const accountId = await getAccountId();
    const url = `${oandaStreamUrl}/v3/accounts/${accountId}/pricing/stream?instruments=XAU_USD,USD_CNH`;
    const response = await fetch(url, { headers: headers(), signal });
    if (!response.ok || !response.body) {
      throw new Error(`OANDA pricing stream ${response.status}`);
    }

    onStatus?.({ state: "connected", detail: `OANDA pricing stream connected (${accountId})` });
    await readPricingStream(response.body, onPrices, signal);
  } catch (error) {
    if (!signal?.aborted) {
      const detail = error instanceof Error ? error.message : "OANDA pricing stream failed";
      if (detail.toLowerCase() === "terminated") {
        onStatus?.({ state: "stopped", detail: "OANDA pricing stream terminated" });
        return;
      }
      onStatus?.({ state: "error", detail });
      return;
    }
  }

  onStatus?.({ state: "stopped", detail: "OANDA pricing stream stopped" });
}

async function readPricingStream(
  body: ReadableStream<Uint8Array>,
  onPrices: (prices: OandaStreamPrice[]) => void | Promise<void>,
  signal?: AbortSignal
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal?.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const prices = parseStreamLine(line);
      if (prices.length) await onPrices(prices);
    }
  }
}

function parseStreamLine(line: string): OandaStreamPrice[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  try {
    const message = JSON.parse(trimmed) as {
      type?: string;
      instrument?: string;
      time?: string;
      closeoutBid?: string;
      closeoutAsk?: string;
    };
    if (message.type !== "PRICE" || !isOandaStreamInstrument(message.instrument)) return [];
    const bid = Number(message.closeoutBid);
    const ask = Number(message.closeoutAsk);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return [];
    return [{
      instrument: message.instrument,
      price: (bid + ask) / 2,
      time: message.time ?? new Date().toISOString()
    }];
  } catch {
    return [];
  }
}

function isOandaStreamInstrument(value: unknown): value is OandaStreamPrice["instrument"] {
  return value === "XAU_USD" || value === "USD_CNH";
}

export async function fetchOandaCandles(
  instrument: "XAU_USD" | "USD_CNH",
  granularity: string = "M15",
  count: number = 2880
): Promise<OandaCandle[]> {
  const cacheKey = `${instrument}:${granularity}:${count}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < CANDLE_CACHE_TTL_MS) return cached.candles;

  const candleUrl = `${oandaBaseUrl}/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`;
  const response = await fetch(candleUrl, { headers: headers() });
  if (!response.ok) throw new Error(`OANDA ${instrument} candles ${response.status}`);

  const json = (await response.json()) as { candles: OandaCandle[] };
  const candles = json.candles.filter((c) => c.complete);
  candleCache.set(cacheKey, { updatedAt: Date.now(), candles });
  return candles;
}

function midpoint(price?: OandaPrice): number | null {
  if (!price) return null;
  return (Number(price.closeoutBid) + Number(price.closeoutAsk)) / 2;
}

function previousCompletedValue(candles: OandaCandle[]) {
  const value = candles.at(-1)?.mid.c;
  return value === undefined ? null : Number(value);
}

function appendLiveValue(candles: OandaCandle[], latest: number | null) {
  const series = candles.map((c) => Number(c.mid.c));
  if (latest !== null) series.push(latest);
  return series;
}

function appendLiveCandle(candles: OandaCandle[], latest: number | null, time?: string) {
  if (latest === null) return candles;
  const lastCandle = candles.at(-1);
  if (lastCandle) {
    const lastSec = Math.floor(new Date(lastCandle.time).getTime() / 1000);
    const liveSec = Math.floor(new Date(time ?? Date.now()).getTime() / 1000);
    if (liveSec <= lastSec) {
      return [
        ...candles,
        {
          time: new Date((lastSec + 1) * 1000).toISOString(),
          complete: false,
          mid: { c: String(latest) }
        }
      ];
    }
  }
  return [
    ...candles,
    {
      time: time ?? new Date().toISOString(),
      complete: false,
      mid: { c: String(latest) }
    }
  ];
}

function makeQuote(
  symbol: Quote["symbol"],
  label: string,
  value: number | null,
  previous: number | null,
  unit: string,
  source: string,
  sparkline: number[]
): Quote {
  const change = value !== null && previous !== null ? value - previous : null;
  return {
    symbol,
    label,
    value,
    change,
    changePct: change !== null && previous ? (change / previous) * 100 : null,
    unit,
    source,
    status: value === null ? "error" : "ok",
    updatedAt: new Date().toISOString(),
    sparkline
  };
}

export async function fetchXauCandles(
  granularity: string,
  count: number,
  latestXau: number | null,
  latestTime?: string
): Promise<CandlePoint[]> {
  const candlesRaw = await fetchOandaCandles("XAU_USD", granularity, count);
  const candlesWithLive = appendLiveCandle(candlesRaw, latestXau, latestTime);
  return candlesWithLive.map((c) => ({
    time: c.time,
    xauUsd: Number(c.mid.c),
    au9999: null,
    sentiment: 0
  }));
}

/**
 * 按指定日期拉 M1 K 线（用于历史数据逐天同步）。
 * OANDA 允许传 from/to 参数，一天最多 1440 根 M1 K 线。
 */
export async function fetchOandaCandlesForDay(
  instrument: "XAU_USD" | "USD_CNH",
  date: string // "YYYY-MM-DD"
): Promise<OandaCandle[]> {
  if (!config.oandaToken) throw new Error("OANDA token missing");

  const from = encodeURIComponent(`${date}T00:00:00Z`);
  const to = encodeURIComponent(`${date}T23:59:59Z`);
  const url = `${oandaBaseUrl}/v3/instruments/${instrument}/candles?granularity=M1&from=${from}&to=${to}&price=M`;

  const response = await fetch(url, { headers: headers() });
  if (response.status === 404 || response.status === 422) return []; // weekend / holiday
  if (!response.ok) throw new Error(`OANDA ${instrument} candles for day ${date}: ${response.status}`);
  const json = (await response.json()) as { candles?: OandaCandle[] };
  return (json.candles ?? []).filter((c) => c.complete);
}

