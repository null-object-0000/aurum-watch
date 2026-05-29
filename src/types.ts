export type TimeRange = "1H" | "4H" | "1D" | "7D" | "30D";
export type Health = "ok" | "stale" | "error" | "unconfigured";
export type Direction = "bullish" | "bearish" | "neutral";

export interface Quote {
  symbol: string;
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
  llmImpactScore?: number | null;
  llmAnalyzed?: boolean;
  llmConfidence?: number | null;
  llmImpactHorizon?: string | null;
  llmLogs?: string[];
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
  dataPoints: number;
}

export interface FactorBreakdown {
  technical: number;
  premium: number;
  sentiment: number;
  weights: { technical: number; premium: number; sentiment: number };
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
  predictions: Array<{
    horizon: string;
    direction: Direction;
    score: number;
    confidence: number;
    probabilities: { bullish: number; neutral: number; bearish: number };
    factorBreakdown?: FactorBreakdown;
  }>;
  explanation: string[];
  conclusion: string;
  sources: Array<{ name: string; status: Health; detail: string }>;
  updatedAt: string;
  technicalIndicators?: TechnicalIndicators;
}
