import React from "react";
import { createChart, createSeriesMarkers, ColorType, HistogramSeries, LineSeries } from "lightweight-charts";
import type { CandlePoint, TimeRange } from "../types";
import { chartTickTime, chartTime, chartTooltipTime } from "../utils/format";
import { Button } from "@/components/ui/button";

interface PriceChartProps {
  candles: CandlePoint[];
  fxRate?: number | null;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
}

type PriceUnit = "USD" | "CNY";

const TROY_OUNCE_GRAMS = 31.1034768;
const RANGE_GRANULARITY: Record<TimeRange, string> = {
  "1H": "1m",
  "4H": "5m",
  "1D": "15m",
  "7D": "2h",
  "30D": "6h"
};

export function PriceChart({ candles, fxRate, range, onRangeChange }: PriceChartProps) {
  const [unit, setUnit] = React.useState<PriceUnit>("USD");
  const priceRef = React.useRef<HTMLDivElement>(null);
  const sentimentRef = React.useRef<HTMLDivElement>(null);
  const visibleCandles = candles;
  const xauLabel = unit === "USD" ? "XAU/USD" : "XAU（元/克）";
  const showAuLine = unit === "CNY";

  const chartInstancesRef = React.useRef<{
    priceChart: ReturnType<typeof createChart>;
    sentimentChart: ReturnType<typeof createChart>;
    xauLine: any;
    auLine: any;
    bars: any;
  } | null>(null);

  React.useEffect(() => {
    if (!priceRef.current || !sentimentRef.current) return;
    priceRef.current.innerHTML = "";
    sentimentRef.current.innerHTML = "";
    const theme = chartTheme();

    const priceChart = createChart(priceRef.current, {
      height: 230,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: theme.muted, attributionLogo: false },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      localization: { timeFormatter: (time: unknown) => chartTooltipTime(Number(time)) },
      rightPriceScale: { borderColor: theme.border, minimumWidth: 65 },
      timeScale: {
        borderColor: theme.border,
        visible: true,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: unknown) => chartTickTime(Number(time), range)
      }
    });
    const xauLine = priceChart.addSeries(LineSeries, { color: theme.gold, lineWidth: 2 });

    const sentimentChart = createChart(sentimentRef.current, {
      height: 122,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: theme.muted, attributionLogo: false },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      localization: { timeFormatter: (time: unknown) => chartTooltipTime(Number(time)) },
      rightPriceScale: { visible: true, borderColor: theme.border, minimumWidth: 65 },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: theme.border,
        visible: true,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: unknown) => chartTickTime(Number(time), range)
      }
    });
    const bars = sentimentChart.addSeries(HistogramSeries, {
      priceScaleId: "right",
      priceFormat: {
        type: "custom",
        formatter: (price: number) => price > 0 ? `+${price.toFixed(0)}` : price.toFixed(0),
      }
    });

    chartInstancesRef.current = {
      priceChart,
      sentimentChart,
      xauLine,
      auLine: null,
      bars
    };

    // Synchronize visible logical ranges between priceChart and sentimentChart
    let isSyncing = false;
    const priceTimeScale = priceChart.timeScale();
    const sentimentTimeScale = sentimentChart.timeScale();

    const handlePriceRangeChange = (logicalRange: any) => {
      if (isSyncing || !logicalRange) return;
      isSyncing = true;
      sentimentTimeScale.setVisibleLogicalRange(logicalRange);
      isSyncing = false;
    };

    const handleSentimentRangeChange = (logicalRange: any) => {
      if (isSyncing || !logicalRange) return;
      isSyncing = true;
      priceTimeScale.setVisibleLogicalRange(logicalRange);
      isSyncing = false;
    };

    priceTimeScale.subscribeVisibleLogicalRangeChange(handlePriceRangeChange);
    sentimentTimeScale.subscribeVisibleLogicalRangeChange(handleSentimentRangeChange);

    const handleResize = () => {
      if (priceRef.current && sentimentRef.current) {
        priceChart.resize(priceRef.current.clientWidth, 230);
        sentimentChart.resize(sentimentRef.current.clientWidth, 122);
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      priceTimeScale.unsubscribeVisibleLogicalRangeChange(handlePriceRangeChange);
      sentimentTimeScale.unsubscribeVisibleLogicalRangeChange(handleSentimentRangeChange);
      priceChart.remove();
      sentimentChart.remove();
      chartInstancesRef.current = null;
    };
  }, [range]);

  React.useEffect(() => {
    const instances = chartInstancesRef.current;
    if (!instances) return;

    const { priceChart, sentimentChart, xauLine, bars } = instances;

    const xauData = visibleCandles
      .map((c) => ({ time: chartTime(c.time), value: chartValue(c, unit, fxRate) }))
      .filter((point): point is { time: never; value: number } => point.value !== null);
    xauLine.setData(xauData);
    createSeriesMarkers(xauLine, eventMarkers(visibleCandles));

    const auSeries = showAuLine ? visibleCandles.filter((c) => c.au9999 !== null) : [];
    if (showAuLine && auSeries.length) {
      if (!instances.auLine) {
        instances.auLine = priceChart.addSeries(LineSeries, { color: cssVar("--chart-blue", "#328bd8"), lineWidth: 2, priceScaleId: "right" });
      }
      const auData = auSeries.map((c) => ({ time: chartTime(c.time), value: c.au9999! }));
      instances.auLine.setData(auData);
    } else {
      if (instances.auLine) {
        priceChart.removeSeries(instances.auLine);
        instances.auLine = null;
      }
    }

    const rootStyles = getComputedStyle(document.documentElement);
    const upColor = rootStyles.getPropertyValue("--up-color").trim() || "#d94b55";
    const downColor = rootStyles.getPropertyValue("--down-color").trim() || "#31b978";
    const neutralColor = rootStyles.getPropertyValue("--neutral").trim() || "#6d7683";

    const barsData = visibleCandles.map((c) => ({
      time: chartTime(c.time),
      value: c.sentiment,
      color: c.sentiment > 0 ? upColor : c.sentiment < 0 ? downColor : neutralColor
    }));
    bars.setData(barsData);

    priceChart.timeScale().fitContent();
    sentimentChart.timeScale().fitContent();
  }, [visibleCandles, unit, fxRate, showAuLine, range]);

  if (!candles.length) return <div className="empty-state">OANDA 蜡烛数据不可用，配置 token 后显示走势。</div>;

  return (
    <div className="price-module">
      <div className="chart-toolbar">
        <div className="chart-legend">
          <span><i className="legend-xau" />{xauLabel}</span>
          {showAuLine && <span><i className="legend-au" />AU9999（元/克）</span>}
          <span><i className="legend-event" />事件标记</span>
          <span className="chart-granularity">粒度 {RANGE_GRANULARITY[range]} · 本地时区</span>
        </div>
        <div className="chart-controls">
          {(["1H", "4H", "1D", "7D", "30D"] as TimeRange[]).map((item) => (
            <Button
              key={item}
              variant={item === range ? "secondary" : "ghost"}
              size="sm"
              className={item === range ? "active" : ""}
              onClick={() => onRangeChange(item)}
            >
              {item}
            </Button>
          ))}
          <span />
          {(["USD", "CNY"] as PriceUnit[]).map((item) => (
            <Button
              key={item}
              variant={item === unit ? "secondary" : "ghost"}
              size="sm"
              className={item === unit ? "active" : ""}
              onClick={() => setUnit(item)}
            >
              {item}
            </Button>
          ))}
        </div>
      </div>
      <div className="price-chart" ref={priceRef} />
      <div className="sentiment-chart-title">舆情强度（利多 - 利空）</div>
      <div className="sentiment-chart" ref={sentimentRef} />
      <div className="sentiment-axis-labels">
        <span className="green">强利空</span>
        <span>中性</span>
        <span className="red">强利多</span>
      </div>
    </div>
  );
}

// Candles are pre-filtered and set to correct granularity by the backend

function chartValue(candle: CandlePoint, unit: PriceUnit, fxRate?: number | null) {
  if (candle.xauUsd === null) return null;
  if (unit === "USD") return candle.xauUsd;
  if (!fxRate) return null;
  return (candle.xauUsd * fxRate) / TROY_OUNCE_GRAMS;
}

function eventMarkers(candles: CandlePoint[]) {
  return candles
    .filter((candle) => Math.abs(candle.sentiment) >= 20)
    .slice(-6)
    .map((candle, index) => ({
      time: chartTime(candle.time),
      position: candle.sentiment > 0 ? "aboveBar" as const : "belowBar" as const,
      color: cssVar("--chart-event", "#8c5bd6"),
      shape: "circle" as const,
      text: String.fromCharCode(65 + index)
    }));
}

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function chartTheme() {
  const root = getComputedStyle(document.documentElement);
  const border = root.getPropertyValue("--border").trim() || "#303a48";
  const muted = root.getPropertyValue("--muted-foreground").trim() || "#8b96a6";
  return {
    border,
    muted,
    grid: border,
    gold: root.getPropertyValue("--chart-gold").trim() || "#d3a72d"
  };
}
