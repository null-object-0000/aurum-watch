import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import net from "node:net";
import { config, oandaBaseUrl, oandaStreamUrl } from "../config.js";
import type { CandlePoint, Health, Quote } from "../types.js";
import { getQuote } from "../db.js";

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

async function requestOanda(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<{
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  json: () => Promise<any>;
  text: () => Promise<string>;
  body: any;
}> {
  const url = new URL(urlStr);
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? 30000;
  const signal = options.signal;

  const proxyUrlStr =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy;

  return new Promise((resolve, reject) => {
    let resolvedOrRejected = false;
    let activeReq: any = null;
    let timeoutId: any = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const safeResolve = (val: any) => {
      if (resolvedOrRejected) return;
      resolvedOrRejected = true;
      cleanup();
      resolve(val);
    };

    const safeReject = (err: Error) => {
      if (resolvedOrRejected) return;
      resolvedOrRejected = true;
      cleanup();
      if (activeReq) {
        try {
          activeReq.destroy();
        } catch (_) {}
      }
      reject(err);
    };

    if (timeoutMs > 0 && timeoutMs !== Infinity) {
      timeoutId = setTimeout(() => {
        safeReject(new Error(`OANDA request timeout (${timeoutMs}ms) to ${urlStr}`));
      }, timeoutMs);
    }

    const onAbort = () => {
      safeReject(new Error("OANDA request aborted"));
    };

    if (signal) {
      if (signal.aborted) {
        return onAbort();
      }
      signal.addEventListener("abort", onAbort);
    }

    const headers = {
      ...options.headers,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };

    const handleResponse = (res: any) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      
      const resHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (value !== undefined) {
          resHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
        }
      }

      safeResolve({
        ok,
        status: res.statusCode || 0,
        headers: resHeaders,
        body: res,
        text: () => {
          return new Promise((resText, rejText) => {
            let data = "";
            res.on("data", (chunk: any) => (data += chunk));
            res.on("end", () => resText(data));
            res.on("error", (err: any) => rejText(err));
          });
        },
        json: async () => {
          const text = await new Promise<string>((resText, rejText) => {
            let data = "";
            res.on("data", (chunk: any) => (data += chunk));
            res.on("end", () => resText(data));
            res.on("error", (err: any) => rejText(err));
          });
          return JSON.parse(text);
        },
      });
    };

    if (proxyUrlStr) {
      const proxy = new URL(proxyUrlStr);
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

        const reqFn = url.protocol === "https:" ? https.request : http.request;
        const req = reqFn(
          urlStr,
          {
            method,
            headers,
            agent,
          },
          handleResponse
        );
        activeReq = req;
        req.on("error", safeReject);
        req.end();
      } else {
        if (url.protocol === "https:") {
          const proxyReqFn = proxy.protocol === "https:" ? https.request : http.request;
          const connectReq = proxyReqFn({
            host: proxy.hostname,
            port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
            method: "CONNECT",
            path: `${url.hostname}:443`,
            headers: {
              Host: `${url.hostname}:443`,
            },
          });
          activeReq = connectReq;

          connectReq.on("connect", (res, socket) => {
            if (res.statusCode === 200) {
              const agent = new https.Agent({ keepAlive: true });
              (agent as any).createConnection = () => socket;
              
              const req = https.request(
                urlStr,
                {
                  method,
                  headers,
                  agent,
                },
                handleResponse
              );
              activeReq = req;
              req.on("error", safeReject);
              req.end();
            } else {
              safeReject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
            }
          });

          connectReq.on("error", safeReject);
          connectReq.end();
        } else {
          const req = http.request(
            {
              host: proxy.hostname,
              port: proxy.port || 80,
              path: urlStr,
              method,
              headers,
            },
            handleResponse
          );
          activeReq = req;
          req.on("error", safeReject);
          req.end();
        }
      }
    } else {
      const reqFn = url.protocol === "https:" ? https.request : http.request;
      const req = reqFn(
        urlStr,
        {
          method,
          headers,
        },
        handleResponse
      );
      activeReq = req;
      req.on("error", safeReject);
      req.end();
    }
  });
}

async function fetchWithTimeout(
  urlStr: string | URL,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
  timeoutMs = 30000
): Promise<any> {
  const url = typeof urlStr === "string" ? urlStr : urlStr.toString();
  return requestOanda(url, {
    method: "GET",
    headers: init?.headers,
    timeoutMs,
    signal: init?.signal
  });
}

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
      fetchWithTimeout(priceUrl, { headers: headers() }),
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
    
    const xauCached = getQuote("XAU_USD");
    const cnhCached = getQuote("USD_CNH");

    const xauQuote = xauCached
      ? { ...xauCached, status: "error" as const, error: message }
      : { ...unavailable("XAU_USD", "XAU/USD", "USD/oz", message), status: "error" as const };

    const cnhQuote = cnhCached
      ? { ...cnhCached, status: "error" as const, error: message }
      : { ...unavailable("USD_CNH", "USD/CNH", "rate", message), status: "error" as const };

    return {
      quotes: [xauQuote, cnhQuote],
      candles: [],
      status: "error",
      detail: message
    };
  }
}

async function getAccountId() {
  if (resolvedAccountId) return resolvedAccountId;

  const response = await fetchWithTimeout(`${oandaBaseUrl}/v3/accounts`, { headers: headers() });
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
    const response = await requestOanda(url, {
      headers: headers(),
      timeoutMs: 0, // No timeout for stream
      signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`OANDA pricing stream ${response.status}`);
    }

    onStatus?.({ state: "connected", detail: `OANDA pricing stream connected (${accountId})` });
    await readPricingStream(response.body, onPrices, signal);
  } catch (error) {
    if (!signal?.aborted) {
      let detail = error instanceof Error ? error.message : "OANDA pricing stream failed";
      if (error instanceof Error && error.cause) {
        const causeMsg = error.cause instanceof Error ? error.cause.message : String(error.cause);
        detail += ` (cause: ${causeMsg})`;
      }
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
  body: any,
  onPrices: (prices: OandaStreamPrice[]) => void | Promise<void>,
  signal?: AbortSignal
) {
  const decoder = new TextDecoder();
  let buffer = "";

  const processChunk = async (chunk: Uint8Array | string) => {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const prices = parseStreamLine(line);
      if (prices.length) await onPrices(prices);
    }
  };

  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      while (!signal?.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) await processChunk(value);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const onAbort = () => {
      body.destroy?.();
    };
    if (signal) {
      signal.addEventListener("abort", onAbort);
    }
    try {
      for await (const chunk of body) {
        if (signal?.aborted) break;
        await processChunk(chunk);
      }
    } finally {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      body.destroy?.();
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
  const response = await fetchWithTimeout(candleUrl, { headers: headers() });
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

  const now = new Date();
  const fromTime = new Date(`${date}T00:00:00Z`);

  // If the query "from" date is in the future relative to current UTC time, return empty array (e.g. timezone offset issues)
  if (fromTime.getTime() > now.getTime()) {
    return [];
  }

  let toTimeStr = `${date}T23:59:59Z`;
  const toTime = new Date(toTimeStr);

  // If the query "to" date is in the future, cap it at current time to prevent OANDA 400 Bad Request
  if (toTime.getTime() > now.getTime()) {
    toTimeStr = now.toISOString();
  }

  const from = encodeURIComponent(`${date}T00:00:00Z`);
  const to = encodeURIComponent(toTimeStr);
  const url = `${oandaBaseUrl}/v3/instruments/${instrument}/candles?granularity=M1&from=${from}&to=${to}&price=M`;

  const response = await fetchWithTimeout(url, { headers: headers() });
  if (response.status === 404 || response.status === 422) return []; // weekend / holiday
  if (!response.ok) throw new Error(`OANDA ${instrument} candles for day ${date}: ${response.status}`);
  const json = (await response.json()) as { candles?: OandaCandle[] };
  return (json.candles ?? []).filter((c) => c.complete);
}
