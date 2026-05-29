import type { DashboardPayload, FactorBreakdown, NewsEvent, Prediction, Quote, TechnicalIndicators } from "./types.js";
import { db } from "./db.js";

// ─── Public API ───────────────────────────────────────────────────────────

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

  const xauCnyUpdatedAt = xauQuote?.updatedAt && cnhQuote?.updatedAt
    ? new Date(Math.min(new Date(xauQuote.updatedAt).getTime(), new Date(cnhQuote.updatedAt).getTime())).toISOString()
    : null;

  const premiumUpdatedAt = auQuote?.updatedAt && xauCnyUpdatedAt
    ? new Date(Math.min(new Date(auQuote.updatedAt).getTime(), new Date(xauCnyUpdatedAt).getTime())).toISOString()
    : null;

  return [
    ...quotes,
    derived(
      "XAU_CNY_G",
      "伦敦金人民币克价",
      xauCny,
      previousXauCny,
      "CNY/g",
      xau !== null && cnh !== null ? "计算值" : "Requires XAU/USD and USD/CNH",
      xauCnySparkline,
      xauCnyUpdatedAt
    ),
    derived(
      "DOMESTIC_PREMIUM",
      "国内外价差",
      premium,
      previousPremium,
      "CNY/g",
      au !== null && xauCny !== null ? "计算值" : "Requires AU9999 and converted XAU",
      premiumSparkline,
      premiumUpdatedAt
    )
  ];
}

export function buildDashboard(input: Omit<DashboardPayload, "sentiment" | "predictions" | "explanation" | "conclusion">): DashboardPayload {
  const events = input.events;
  const bullish = events.filter((e) => e.impact > 0).reduce((sum, e) => sum + e.impact, 0);
  const bearish = Math.abs(events.filter((e) => e.impact < 0).reduce((sum, e) => sum + e.impact, 0));
  const sentimentScore = Math.round((bullish - bearish) / Math.max(1, events.length));
  const neutralShare = events.length ? Math.round((events.filter((e) => e.direction === "neutral").length / events.length) * 100) : 0;

  // ── Option B: 多因子量化模型 ─────────────────────────────────────────
  const technicalIndicators = input.technicalIndicators ?? computeTechnicalIndicators();
  const technicalScore = computeTechnicalScore(technicalIndicators);

  const premiumQuote = input.quotes.find((q) => q.symbol === "DOMESTIC_PREMIUM");
  const premiumScore = computePremiumScore(premiumQuote);

  const predictions = makePredictions(sentimentScore, technicalScore, premiumScore);
  // ─────────────────────────────────────────────────────────────────────

  const factors = factorScores(events);
  const explanation = makeExplanation(factors, sentimentScore, technicalIndicators, technicalScore, premiumScore, premiumQuote);

  return {
    ...input,
    technicalIndicators,
    sentiment: {
      score: sentimentScore,
      bullish: Math.round(bullish / Math.max(1, events.length)),
      bearish: -Math.round(bearish / Math.max(1, events.length)),
      neutralShare,
      factors
    },
    predictions,
    explanation,
    conclusion: makeConclusion(sentimentScore, technicalScore, input.sources.some((s) => s.status === "error" || s.status === "unconfigured"))
  };
}

// ─── Technical Indicators (Option B) ─────────────────────────────────────

/**
 * 从 history_minutes 读取最近 N 根 XAU_USD 分钟线，计算 EMA/RSI/MACD。
 */
export function computeTechnicalIndicators(lookback = 120): TechnicalIndicators {
  try {
    const rows = db
      .prepare(`SELECT price FROM history_minutes WHERE symbol = 'XAU_USD' ORDER BY time DESC LIMIT ?`)
      .all(lookback) as { price: number }[];

    // history_minutes 是倒序，翻转为正序
    const prices = rows.map((r) => r.price).reverse();
    const n = prices.length;

    if (n < 5) {
      return { ema5: null, ema20: null, ema60: null, rsi14: null, macd: null, dataPoints: n };
    }

    const ema5 = n >= 5 ? calcEMA(prices, 5) : null;
    const ema20 = n >= 20 ? calcEMA(prices, 20) : null;
    const ema60 = n >= 60 ? calcEMA(prices, 60) : null;
    const rsi14 = n >= 15 ? calcRSI(prices, 14) : null;
    const macd = n >= 26 ? calcMACD(prices) : null;

    return { ema5, ema20, ema60, rsi14, macd, dataPoints: n };
  } catch {
    return { ema5: null, ema20: null, ema60: null, rsi14: null, macd: null, dataPoints: 0 };
  }
}

/**
 * 将技术指标转换为 -100~+100 的综合得分。
 */
function computeTechnicalScore(ti: TechnicalIndicators): number {
  if (ti.dataPoints < 5) return 0;

  let score = 0;

  // EMA 排列因子（权重 40%）
  if (ti.ema5 !== null && ti.ema20 !== null && ti.ema60 !== null) {
    if (ti.ema5 > ti.ema20 && ti.ema20 > ti.ema60) {
      score += 40; // 强多头排列
    } else if (ti.ema5 < ti.ema20 && ti.ema20 < ti.ema60) {
      score -= 40; // 强空头排列
    } else if (ti.ema5 > ti.ema20) {
      score += 15; // 短期偏多
    } else if (ti.ema5 < ti.ema20) {
      score -= 15; // 短期偏空
    }
  } else if (ti.ema5 !== null && ti.ema20 !== null) {
    score += ti.ema5 > ti.ema20 ? 15 : -15;
  }

  // RSI 因子（权重 30%）
  if (ti.rsi14 !== null) {
    if (ti.rsi14 > 70) {
      score -= 25; // 超买
    } else if (ti.rsi14 < 30) {
      score += 25; // 超卖
    } else {
      // 30-70 线性映射到 -15~+15（中轴=50 对应 0）
      score += Math.round(((ti.rsi14 - 50) / 20) * 15);
    }
  }

  // MACD 因子（权重 30%）
  if (ti.macd !== null) {
    const hist = ti.macd.histogram;
    // 柱状图越强，信号越强；上限 ±20
    const macdContrib = clamp(Math.round(hist * 2000), -20, 20);
    score += macdContrib;
  }

  return clamp(score, -100, 100);
}

/**
 * 国内外价差均值回归因子。
 * 利用 premiumSparkline 历史值计算均值，判断当前偏离程度。
 */
function computePremiumScore(premiumQuote: Quote | undefined): number {
  if (!premiumQuote || premiumQuote.value === null) return 0;

  const current = premiumQuote.value;
  const sparkline = premiumQuote.sparkline ?? [];

  if (sparkline.length < 3) return 0;

  const mean = sparkline.reduce((sum, v) => sum + v, 0) / sparkline.length;
  if (mean === 0) return 0;

  const deviation = (current - mean) / Math.abs(mean);

  // 溢价过高（>均值 20%）→ 均值回归压力，AU9999 偏空
  // 溢价过低（<均值 -20%）→ 修复弹性，AU9999 偏多
  if (deviation > 0.5) return -35;
  if (deviation > 0.2) return -20;
  if (deviation > 0.1) return -10;
  if (deviation < -0.5) return 35;
  if (deviation < -0.2) return 20;
  if (deviation < -0.1) return 10;
  return 0;
}

// ─── Multi-Factor Predictions (Option B) ─────────────────────────────────

/**
 * 三因子加权预测，各周期权重体现不同因子的时效特征：
 * - 短期（1H/4H）：技术面权重高
 * - 长期（3D/7D）：情感面权重高
 * - 价差因子：中期均匀分布
 */
function makePredictions(
  sentimentScore: number,
  technicalScore: number,
  premiumScore: number
): Prediction[] {
  const horizons: Array<{
    horizon: string;
    weights: { technical: number; premium: number; sentiment: number };
  }> = [
    { horizon: "1小时",  weights: { technical: 0.60, premium: 0.20, sentiment: 0.20 } },
    { horizon: "4小时",  weights: { technical: 0.50, premium: 0.20, sentiment: 0.30 } },
    { horizon: "1天",    weights: { technical: 0.35, premium: 0.25, sentiment: 0.40 } },
    { horizon: "3天",    weights: { technical: 0.25, premium: 0.25, sentiment: 0.50 } },
    { horizon: "7天",    weights: { technical: 0.15, premium: 0.25, sentiment: 0.60 } },
  ];

  return horizons.map(({ horizon, weights }) => {
    const score = Math.round(
      technicalScore * weights.technical +
      premiumScore   * weights.premium +
      sentimentScore * weights.sentiment
    );

    const bullish = clamp(34 + score, 5, 88);
    const bearish = clamp(34 - score, 5, 88);
    const neutral = Math.max(5, 100 - bullish - bearish);

    const factorBreakdown: FactorBreakdown = {
      technical: technicalScore,
      premium: premiumScore,
      sentiment: sentimentScore,
      weights
    };

    return {
      horizon,
      direction: score > 12 ? "bullish" : score < -12 ? "bearish" : "neutral",
      score,
      confidence: clamp(45 + Math.round(Math.abs(score) * 0.4), 35, 88),
      probabilities: { bullish, neutral, bearish },
      factorBreakdown
    };
  });
}

// ─── Explanation ──────────────────────────────────────────────────────────

function makeExplanation(
  factors: Array<{ name: string; value: number }>,
  sentimentScore: number,
  ti: TechnicalIndicators,
  technicalScore: number,
  premiumScore: number,
  premiumQuote: Quote | undefined
): string[] {
  const lines: string[] = [];

  // 技术面说明
  if (ti.dataPoints >= 5) {
    const emaDesc = formatEmaDesc(ti);
    const rsiDesc = ti.rsi14 !== null ? `RSI(14)=${ti.rsi14.toFixed(1)}，${formatRsiLevel(ti.rsi14)}` : "";
    const macdDesc = ti.macd !== null
      ? `MACD柱=${ti.macd.histogram > 0 ? "+" : ""}${(ti.macd.histogram).toFixed(4)}，${ti.macd.histogram > 0 ? "多头动能" : "空头动能"}`
      : "";
    const techParts = [emaDesc, rsiDesc, macdDesc].filter(Boolean).join("；");
    lines.push(`📈 技术面：${techParts}。技术综合得分 ${technicalScore > 0 ? "+" : ""}${technicalScore}。`);
  } else {
    lines.push(`📈 技术面：历史数据不足（${ti.dataPoints} 根），技术因子暂取中性。`);
  }

  // 价差面说明
  if (premiumQuote?.value !== null && premiumQuote?.value !== undefined) {
    const sparkline = premiumQuote.sparkline ?? [];
    const mean = sparkline.length > 0 ? sparkline.reduce((s, v) => s + v, 0) / sparkline.length : premiumQuote.value;
    lines.push(
      `⚖️ 价差面：当前国内溢价 ¥${premiumQuote.value.toFixed(2)}/g（近期均值 ¥${mean.toFixed(2)}/g），` +
      `${premiumScore < 0 ? "溢价偏高，均值回归压力" : premiumScore > 0 ? "溢价偏低，存在修复弹性" : "溢价正常"}。价差因子得分 ${premiumScore > 0 ? "+" : ""}${premiumScore}。`
    );
  }

  // 舆情面说明
  const topFactors = factors.slice(0, 3).map((f) => `${f.name}(${f.value > 0 ? "+" : ""}${f.value})`).join("、");
  const llmMode = "综合情感";
  lines.push(
    `🗞️ 舆情面：${llmMode}得分 ${sentimentScore > 0 ? "+" : ""}${sentimentScore}` +
    (topFactors ? `，主要驱动：${topFactors}` : "") + "。"
  );

  // 因子贡献小结（根据新闻分类）
  for (const factor of factors) {
    lines.push(
      `${factor.name} 当前贡献 ${factor.value > 0 ? "+" : ""}${factor.value}，对黄金形成${factor.value >= 0 ? "支撑" : "压制"}。`
    );
  }

  if (!factors.length) lines.push("新闻源暂未返回足够事件，当前只展示已接入行情状态。");

  lines.push(`综合加权结论：短期以技术面主导，中长期以舆情面主导。以上分析不构成交易建议。`);

  return lines;
}

function formatEmaDesc(ti: TechnicalIndicators): string {
  const parts: string[] = [];
  if (ti.ema5 !== null) parts.push(`EMA5=${ti.ema5.toFixed(2)}`);
  if (ti.ema20 !== null) parts.push(`EMA20=${ti.ema20.toFixed(2)}`);
  if (ti.ema60 !== null) parts.push(`EMA60=${ti.ema60.toFixed(2)}`);
  if (!parts.length) return "";

  if (ti.ema5 && ti.ema20 && ti.ema60) {
    if (ti.ema5 > ti.ema20 && ti.ema20 > ti.ema60) return parts.join(" > ") + "（多头排列）";
    if (ti.ema5 < ti.ema20 && ti.ema20 < ti.ema60) return parts.join(" < ").replace(/ > /g, " < ") + "（空头排列）";
    return parts.join(" / ") + "（多空交织）";
  }
  return parts.join(" / ");
}

function formatRsiLevel(rsi: number): string {
  if (rsi > 70) return "超买区间，注意回调压力";
  if (rsi > 60) return "偏强但未超买";
  if (rsi < 30) return "超卖区间，关注反弹机会";
  if (rsi < 40) return "偏弱但未超卖";
  return "中性区间";
}

function makeConclusion(sentimentScore: number, technicalScore: number, hasDataIssue: boolean): string {
  const combined = Math.round(sentimentScore * 0.5 + technicalScore * 0.5);
  const bias = combined > 20 ? "短线偏多" : combined < -20 ? "短线偏空" : "短线中性";
  const caveat = hasDataIssue ? "部分真实数据源未配置或异常，结论可信度受限。" : "真实行情与新闻源均已接入。";
  return `${bias}。${caveat}系统只解释影响因素，不输出买入或卖出建议。`;
}

// ─── Technical Indicator Calculations ────────────────────────────────────

/** 指数移动平均线 */
function calcEMA(prices: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(4));
}

/** 相对强弱指标 RSI(n) */
function calcRSI(prices: number[], period: number): number {
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));

  let avgGain = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

/** MACD(12, 26, 9) */
function calcMACD(prices: number[]): { macdLine: number; signalLine: number; histogram: number } {
  const ema12 = calcEMAStream(prices, 12);
  const ema26 = calcEMAStream(prices, 26);

  // MACD 线序列（从第 26 个点开始）
  const macdSeries: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdSeries.push(ema12[i + (ema12.length - ema26.length)] - ema26[i]);
  }

  const signalSeries = calcEMAStream(macdSeries, 9);
  const macdLine = macdSeries[macdSeries.length - 1];
  const signalLine = signalSeries[signalSeries.length - 1];

  return {
    macdLine: parseFloat(macdLine.toFixed(6)),
    signalLine: parseFloat(signalLine.toFixed(6)),
    histogram: parseFloat((macdLine - signalLine).toFixed(6))
  };
}

/** 返回 EMA 完整序列（用于 MACD 计算） */
function calcEMAStream(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  result.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// ─── Sentiment Factor Scores ──────────────────────────────────────────────

function factorScores(events: NewsEvent[]) {
  const groups = new Map<string, number>();
  for (const event of events) groups.set(event.category, (groups.get(event.category) ?? 0) + event.impact);
  return Array.from(groups.entries())
    .map(([name, value]) => ({ name, value: Math.max(-100, Math.min(100, Math.round(value))) }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 6);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function derived(
  symbol: Quote["symbol"],
  label: string,
  value: number | null,
  previous: number | null,
  unit: string,
  source: string,
  sparkline: number[],
  updatedAt: string | null
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
    updatedAt: value === null ? null : updatedAt,
    sparkline
  };
}

function previousValue(quote?: Quote) {
  if (!quote || quote.value === null || quote.change === null) return null;
  return quote.value - quote.change;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
