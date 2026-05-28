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
  }>;
  explanation: string[];
  conclusion: string;
  sources: Array<{ name: string; status: Health; detail: string }>;
  updatedAt: string;
}
