import { config } from "../config.js";
import type { Quote } from "../types.js";

export async function fetchAu9999(): Promise<Quote> {
  if (config.aktoolsBaseUrl) {
    return fetchFromAktools();
  }

  return unavailable("AKTOOLS_BASE_URL is not configured", "unconfigured");
}

async function fetchFromAktools(): Promise<Quote> {
  const url = new URL("/api/public/spot_quotations_sge", normalizedBaseUrl(config.aktoolsBaseUrl));
  url.searchParams.set("symbol", config.aktoolsAu9999Symbol);

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
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
      sparkline: points.map((point) => point.price).slice(-120)
    };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "AKTools AU9999 failed", "error");
  }
}

interface AktoolsPoint {
  price: number;
  updatedAt: string | null;
}

function parseAktoolsRow(row: unknown): AktoolsPoint | null {
  if (!row || typeof row !== "object") return null;

  const record = row as Record<string, unknown>;
  const price = numberFrom(record["现价"] ?? record.price ?? record.value ?? record.last);
  if (price === null) return null;

  return {
    price,
    updatedAt: dateFrom(record["更新时间"] ?? record.updatedAt ?? record.time)
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
    error: reason
  };
}

function numberFrom(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function dateFrom(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  const direct = new Date(value);
  if (Number.isFinite(direct.getTime())) return direct.toISOString();

  const normalized = value
    .replace("年", "-")
    .replace("月", "-")
    .replace("日", "")
    .trim();
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
