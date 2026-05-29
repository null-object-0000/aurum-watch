export type Direction = "bullish" | "bearish" | "neutral";
export type Health = "ok" | "stale" | "error" | "unconfigured";

export interface Quote {
  symbol: "XAU_USD" | "AU9999" | "USD_CNH" | "XAU_CNY_G" | "DOMESTIC_PREMIUM";
  label: string;
  value: number | null;
  change: number | null;
  changePct: number | null;
  unit: string;
  source: string;
  status: Health;
  updatedAt: string | null;
  sparkline: number[];
  error?: string;
  history?: Array<{ price: number; updatedAt: string | null }>;
}

export interface CandlePoint {
  time: string;
  xauUsd: number | null;
  au9999: number | null;
  sentiment: number;
}

export interface NewsEvent {
  id: string;
  time: string;
  source: string;
  title: string;
  category: string;
  direction: Direction;
  impact: number;
  summary: string;
  url?: string;
  /** LLM 分析的原始影响力得分 0-100，未经 LLM 时为 null */
  llmImpactScore?: number | null;
  /** 是否经过 LLM 分析 */
  llmAnalyzed?: boolean;
}

export interface TechnicalIndicators {
  ema5: number | null;
  ema20: number | null;
  ema60: number | null;
  rsi14: number | null;
  macd: {
    macdLine: number;
    signalLine: number;
    histogram: number;
  } | null;
  /** 数据点数量 */
  dataPoints: number;
}

export interface FactorBreakdown {
  /** 技术面综合得分 -100~+100 */
  technical: number;
  /** 国内外价差均值回归因子 -100~+100 */
  premium: number;
  /** 情感因子（LLM 或关键词） -100~+100 */
  sentiment: number;
  /** 各因子权重（三者之和 = 1） */
  weights: { technical: number; premium: number; sentiment: number };
}

export interface Prediction {
  horizon: string;
  direction: Direction;
  score: number;
  confidence: number;
  probabilities: {
    bullish: number;
    neutral: number;
    bearish: number;
  };
  /** 多因子分解（供 Explanation 和 PredictionTable 展示） */
  factorBreakdown?: FactorBreakdown;
}

export interface DashboardPayload {
  quotes: Quote[];
  candles: CandlePoint[];
  sentiment: {
    score: number;
    bullish: number;
    bearish: number;
    neutralShare: number;
    factors: Array<{ name: string; value: number }>;
  };
  events: NewsEvent[];
  predictions: Prediction[];
  explanation: string[];
  conclusion: string;
  sources: Array<{ name: string; status: Health; detail: string }>;
  updatedAt: string;
  /** 技术指标快照（Option B） */
  technicalIndicators?: TechnicalIndicators;
}
