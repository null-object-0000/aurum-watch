import type { Direction, Health } from "../types";

export function statusLabel(status: Health) {
  return ({ ok: "正常", stale: "延迟", error: "异常", unconfigured: "未配置" })[status];
}

export function directionText(direction?: Direction) {
  return direction === "bullish" ? "偏多" : direction === "bearish" ? "偏空" : "中性";
}

export function directionTone(direction?: Direction) {
  return direction === "bullish" ? "red" : direction === "bearish" ? "green" : "";
}

export function marketTone(value?: number | null) {
  if (value === null || value === undefined || value === 0) return "";
  return value > 0 ? "red" : "green";
}

export function quoteMeta(symbol?: string) {
  const map: Record<string, { title: string; subtitle: string; sourceLabel?: string }> = {
    XAU_USD: { title: "XAU/USD", subtitle: "伦敦金（美元/盎司）", sourceLabel: "OANDA" },
    AU9999: { title: "AU9999", subtitle: "上海黄金交易所（元/克）", sourceLabel: "SFE" },
    USD_CNH: { title: "USD/CNH", subtitle: "美元/离岸人民币", sourceLabel: "FOREX" },
    XAU_CNY_G: { title: "伦敦金人民币克价", subtitle: "（元/克）", sourceLabel: "计算值" },
    DOMESTIC_PREMIUM: { title: "国内外价差", subtitle: "AU9999 - 伦敦金人民币克价" }
  };
  return map[symbol ?? ""] ?? { title: "--", subtitle: "" };
}
