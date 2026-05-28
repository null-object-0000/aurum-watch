import type { Quote } from "../types";

export function formatNumber(value?: number | null) {
  return value === null || value === undefined
    ? "--"
    : value.toLocaleString("en-US", { maximumFractionDigits: value > 100 ? 2 : 4 });
}

export function formatQuoteValue(quote?: Quote) {
  if (!quote || quote.value === null || quote.value === undefined) return "--";
  const digits = quote.symbol === "USD_CNH" ? 4 : 2;
  return quote.value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatSigned(value?: number | null) {
  return value === null || value === undefined ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

export function formatPct(value?: number | null) {
  return value === null || value === undefined ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatClock(value: Date) {
  return value.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

export function chartTime(value: string) {
  return Math.floor(new Date(value).getTime() / 1000) as never;
}
