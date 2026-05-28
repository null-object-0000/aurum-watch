import type { DashboardPayload, NewsEvent, Prediction, Quote } from "./types.js";

export function derivedQuotes(quotes: Quote[]): Quote[] {
  const xauQuote = quotes.find((q) => q.symbol === "XAU_USD");
  const auQuote = quotes.find((q) => q.symbol === "AU9999");
  const cnhQuote = quotes.find((q) => q.symbol === "USD_CNH");
  const xau = xauQuote?.value ?? null;
  const au = auQuote?.value ?? null;
  const cnh = cnhQuote?.value ?? null;
  const xauCny = xau !== null && cnh !== null ? (xau * cnh) / 31.1034768 : null;
  const premium = au !== null && xauCny !== null ? au - xauCny : null;
  const previousXau = previousValue(xauQuote);
  const previousCnh = previousValue(cnhQuote);
  const previousAu = previousValue(auQuote);
  const previousXauCny = previousXau !== null && previousCnh !== null ? (previousXau * previousCnh) / 31.1034768 : null;
  const previousPremium = previousAu !== null && previousXauCny !== null ? previousAu - previousXauCny : null;
  const xauCnySparkline = xauQuote?.sparkline?.length && cnh !== null
    ? xauQuote.sparkline.map((point) => (point * cnh) / 31.1034768)
    : [];
  const premiumSparkline = auQuote?.sparkline?.length && xauCnySparkline.length
    ? auQuote.sparkline.slice(-xauCnySparkline.length).map((point, index) => point - xauCnySparkline[index])
    : [];

  return [
    ...quotes,
    derived(
      "XAU_CNY_G",
      "伦敦金人民币克价",
      xauCny,
      previousXauCny,
      "CNY/g",
      xau !== null && cnh !== null ? "Calculated" : "Requires XAU/USD and USD/CNH",
      xauCnySparkline
    ),
    derived(
      "DOMESTIC_PREMIUM",
      "国内外价差",
      premium,
      previousPremium,
      "CNY/g",
      au !== null && xauCny !== null ? "Calculated" : "Requires AU9999 and converted XAU",
      premiumSparkline
    )
  ];
}

export function buildDashboard(input: Omit<DashboardPayload, "sentiment" | "predictions" | "explanation" | "conclusion">): DashboardPayload {
  const events = input.events;
  const bullish = events.filter((e) => e.impact > 0).reduce((sum, e) => sum + e.impact, 0);
  const bearish = Math.abs(events.filter((e) => e.impact < 0).reduce((sum, e) => sum + e.impact, 0));
  const score = Math.round((bullish - bearish) / Math.max(1, events.length));
  const neutralShare = events.length ? Math.round((events.filter((e) => e.direction === "neutral").length / events.length) * 100) : 0;

  const predictions = makePredictions(score);
  const factors = factorScores(events);
  const explanation = makeExplanation(factors, score);

  return {
    ...input,
    sentiment: {
      score,
      bullish: Math.round(bullish / Math.max(1, events.length)),
      bearish: -Math.round(bearish / Math.max(1, events.length)),
      neutralShare,
      factors
    },
    predictions,
    explanation,
    conclusion: makeConclusion(score, input.sources.some((s) => s.status === "error" || s.status === "unconfigured"))
  };
}

function derived(
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
    status: value === null ? "unconfigured" : "ok",
    updatedAt: value === null ? null : new Date().toISOString(),
    sparkline
  };
}

function previousValue(quote?: Quote) {
  if (!quote || quote.value === null || quote.change === null) return null;
  return quote.value - quote.change;
}

function makePredictions(base: number): Prediction[] {
  const horizons = [
    ["1小时", 0.55],
    ["4小时", 0.8],
    ["1天", 1],
    ["3天", 0.65],
    ["7天", 0.35]
  ] as const;

  return horizons.map(([horizon, weight]) => {
    const score = Math.round(base * weight);
    const bullish = clamp(34 + score, 5, 85);
    const bearish = clamp(34 - score, 5, 85);
    const neutral = Math.max(5, 100 - bullish - bearish);
    return {
      horizon,
      direction: score > 12 ? "bullish" : score < -12 ? "bearish" : "neutral",
      score,
      confidence: clamp(45 + Math.abs(score), 35, 82),
      probabilities: { bullish, neutral, bearish }
    };
  });
}

function factorScores(events: NewsEvent[]) {
  const groups = new Map<string, number>();
  for (const event of events) groups.set(event.category, (groups.get(event.category) ?? 0) + event.impact);
  return Array.from(groups.entries())
    .map(([name, value]) => ({ name, value: Math.max(-100, Math.min(100, Math.round(value))) }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 6);
}

function makeExplanation(factors: Array<{ name: string; value: number }>, score: number) {
  const lines = factors.map((factor) => `${factor.name} 当前贡献 ${factor.value > 0 ? "+" : ""}${factor.value}，对黄金形成${factor.value >= 0 ? "支撑" : "压制"}。`);
  if (!lines.length) lines.push("新闻源暂未返回足够事件，当前只展示已接入行情状态。");
  lines.push(`聚合影响评分为 ${score > 0 ? "+" : ""}${score}，该结论来自实时新闻事件聚合，不构成交易建议。`);
  return lines;
}

function makeConclusion(score: number, hasDataIssue: boolean) {
  const bias = score > 20 ? "短线偏多" : score < -20 ? "短线偏空" : "短线中性";
  const caveat = hasDataIssue ? "部分真实数据源未配置或异常，结论可信度受限。" : "真实行情与新闻源均已接入。";
  return `${bias}。${caveat}系统只解释影响因素，不输出买入或卖出建议。`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
