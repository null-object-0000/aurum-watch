import type { Quote, TimeRange } from "../types";

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

export function formatSigned(value?: number | null, symbol?: string) {
  if (value === null || value === undefined) return "--";
  const digits = symbol === "USD_CNH" ? 4 : 2;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function formatPct(value?: number | null, symbol?: string) {
  if (value === null || value === undefined) return "--";
  const digits = symbol === "USD_CNH" ? 4 : 2;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
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

export function chartTickTime(value: number, range: TimeRange) {
  const date = new Date(value * 1000);
  if (range === "1H" || range === "4H") {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (range === "1D" || range === "7D") {
    return date.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" });
}

export function chartTooltipTime(value: number) {
  return new Date(value * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
