import { config } from "../config.js";
import type { Quote } from "../types.js";
import { getQuote } from "../db.js";

let lastFetchTime = 0;
let cachedQuote: Quote | null = null;

export async function fetchAu9999(): Promise<Quote> {
  const now = Date.now();
  if (cachedQuote && now - lastFetchTime < config.aktoolsRefreshIntervalMs) {
    return cachedQuote;
  }

  if (config.aktoolsBaseUrl) {
    const quote = await fetchFromAktools();
    cachedQuote = quote;
    lastFetchTime = now;
    return quote;
  }

  return unavailable("AKTOOLS_BASE_URL is not configured", "unconfigured");
}

async function fetchFromAktools(): Promise<Quote> {
  const url = new URL("/api/public/spot_quotations_sge", normalizedBaseUrl(config.aktoolsBaseUrl));
  url.searchParams.set("symbol", config.aktoolsAu9999Symbol);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, { 
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AKTools spot_quotations_sge ${response.status}`);

    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows)) throw new Error("AKTools returned a non-array payload");

    const points = rows
      .map((row) => parseAktoolsRow(row))
      .filter((point): point is AktoolsPoint => point !== null);
    const latest = points.at(-1);
    const opening = points[0];
    const value = latest?.price ?? null;
    const previous = opening?.price ?? null;
    const change = value !== null && previous !== null ? value - previous : null;

    return {
      symbol: "AU9999",
      label: "AU9999",
      value,
      change,
      changePct: change !== null && previous ? (change / previous) * 100 : null,
      unit: "CNY/g",
      source: "AKTools/SGE",
      status: value === null ? "error" : "ok",
      updatedAt: latest?.updatedAt ?? new Date().toISOString(),
      sparkline: points.map((point) => point.price).slice(-120),
      history: points.slice(-120)
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "AKTools AU9999 failed";
    const cached = getQuote("AU9999");
    if (cached) {
      return {
        ...cached,
        status: "error",
        error: reason
      };
    }
    return unavailable(reason, "error");
  } finally {
    clearTimeout(timeoutId);
  }
}

interface AktoolsPoint {
  price: number;
  updatedAt: string | null;
}

function parseAktoolsRow(row: unknown): AktoolsPoint | null {
  if (!row || typeof row !== "object") return null;

  const record = row as Record<string, unknown>;
  
  // If a commodity/symbol is specified in the record, filter it to match only Au99.99
  const recordSymbol = record["商品"] ?? record.symbol ?? record.name ?? record.instrument ?? record["品种"];
  if (recordSymbol && typeof recordSymbol === "string" && !recordSymbol.includes(config.aktoolsAu9999Symbol)) {
    return null;
  }

  const price = numberFrom(record["现价"] ?? record["最新价"] ?? record.price ?? record.value ?? record.last);
  if (price === null) return null;

  // SGE date columns can be "更新时间", "时间", "time", "updatedAt" etc.
  const rawDate = record["更新时间"] ?? record["时间"] ?? record.updatedAt ?? record.time;
  return {
    price,
    updatedAt: dateFrom(rawDate)
  };
}

function normalizedBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function unavailable(reason: string, status: Quote["status"]): Quote {
  return {
    symbol: "AU9999",
    label: "AU9999",
    value: null,
    change: null,
    changePct: null,
    unit: "CNY/g",
    source: "AKTools/SGE",
    status,
    updatedAt: null,
    sparkline: [],
    history: [],
    error: reason
  };
}

function numberFrom(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function dateFrom(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) return null;

  // Clean Chinese characters
  let str = value
    .replace(/年|月/g, "-")
    .replace(/日/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // If it's just a time like "15:45:00" or "15:45"
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(str)) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    str = `${yyyy}-${mm}-${dd} ${str}`;
  }
  // If it has month-day-time but no year, e.g. "05-28 15:45:00" or "5-28 15:45"
  else if (/^\d{1,2}-\d{1,2}\s+\d{2}:\d{2}(:\d{2})?$/.test(str)) {
    const yyyy = new Date().getFullYear();
    str = `${yyyy}-${str}`;
  }
  // If it has month-day but no year and no time, e.g. "05-28"
  else if (/^\d{1,2}-\d{1,2}$/.test(str)) {
    const yyyy = new Date().getFullYear();
    str = `${yyyy}-${str} 00:00:00`;
  }

  // Parse as Beijing Time (CST / UTC+8) if no timezone is specified
  if (!str.endsWith("Z") && !/[+-]\d{2}(:?\d{2})?$/.test(str)) {
    str = str.replace(" ", "T") + "+08:00";
  }

  const date = new Date(str);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
