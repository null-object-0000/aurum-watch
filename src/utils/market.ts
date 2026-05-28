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
  const map: Record<string, { title: string; subtitle: string; sourceLabel?: string; description?: string }> = {
    XAU_USD: {
      title: "XAU/USD",
      subtitle: "伦敦金（美元/盎司）",
      sourceLabel: "OANDA",
      description: "伦敦金（XAU/USD）现货价格，数据源自 OANDA，单位为 美元/盎司。"
    },
    AU9999: {
      title: "AU9999",
      subtitle: "上海黄金交易所（元/克）",
      sourceLabel: "SFE",
      description: "上海黄金交易所 Au99.99 现货价格，数据源自 SGE (AKTools)，单位为 元/克。"
    },
    USD_CNH: {
      title: "USD/CNH",
      subtitle: "美元/离岸人民币",
      sourceLabel: "FOREX",
      description: "离岸人民币汇率，数据源自 FOREX，单位为 汇率比例。"
    },
    XAU_CNY_G: {
      title: "伦敦金人民币克价",
      subtitle: "（元/克）",
      sourceLabel: "计算值",
      description: "根据伦敦金现货价格与离岸人民币汇率实时折算的人民币克价。公式：(伦敦金 * 汇率) / 31.1034768，单位为 元/克。"
    },
    DOMESTIC_PREMIUM: {
      title: "国内外价差",
      subtitle: "AU9999 - 伦敦金人民币克价",
      description: "国内 AU9999 现货价格与国际黄金人民币折算价之间的价差。公式：AU9999 - 伦敦金人民币克价，单位为 元/克。"
    }
  };
  return map[symbol ?? ""] ?? { title: "--", subtitle: "", description: "" };
}
