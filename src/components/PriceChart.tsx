import React from "react";
import { createChart, createSeriesMarkers, ColorType, HistogramSeries, LineSeries } from "lightweight-charts";
import type { CandlePoint } from "../types";
import { chartTime } from "../utils/format";

interface PriceChartProps {
  candles: CandlePoint[];
  fxRate?: number | null;
}

type TimeRange = "1H" | "4H" | "1D" | "7D" | "30D";
type PriceUnit = "USD" | "CNY";

const TIME_RANGE_MS: Record<TimeRange, number> = {
  "1H": 60 * 60 * 1000,
  "4H": 4 * 60 * 60 * 1000,
  "1D": 24 * 60 * 60 * 1000,
  "7D": 7 * 24 * 60 * 60 * 1000,
  "30D": 30 * 24 * 60 * 60 * 1000
};

const TROY_OUNCE_GRAMS = 31.1034768;

export function PriceChart({ candles, fxRate }: PriceChartProps) {
  const [range, setRange] = React.useState<TimeRange>("1D");
  const [unit, setUnit] = React.useState<PriceUnit>("USD");
  const priceRef = React.useRef<HTMLDivElement>(null);
  const sentimentRef = React.useRef<HTMLDivElement>(null);
  const visibleCandles = React.useMemo(() => filterCandles(candles, range), [candles, range]);
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

    const priceChart = createChart(priceRef.current, {
      height: 230,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8b96a6", attributionLogo: false },
      grid: { vertLines: { color: "#202a35" }, horzLines: { color: "#202a35" } },
      rightPriceScale: { borderColor: "#303a48" },
      timeScale: { borderColor: "#303a48", visible: true }
    });
    const xauLine = priceChart.addSeries(LineSeries, { color: "#d3a72d", lineWidth: 2 });

    const sentimentChart = createChart(sentimentRef.current, {
      height: 122,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8b96a6", attributionLogo: false },
      grid: { vertLines: { color: "#202a35" }, horzLines: { color: "#202a35" } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: true, borderColor: "#303a48" },
      timeScale: { borderColor: "#303a48", visible: true }
    });
    const bars = sentimentChart.addSeries(HistogramSeries, { priceScaleId: "left", priceFormat: { type: "volume" } });

    chartInstancesRef.current = {
      priceChart,
      sentimentChart,
      xauLine,
      auLine: null,
      bars
    };

    const handleResize = () => {
      if (priceRef.current && sentimentRef.current) {
        priceChart.resize(priceRef.current.clientWidth, 230);
        sentimentChart.resize(sentimentRef.current.clientWidth, 122);
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      priceChart.remove();
      sentimentChart.remove();
      chartInstancesRef.current = null;
    };
  }, []);

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
        instances.auLine = priceChart.addSeries(LineSeries, { color: "#328bd8", lineWidth: 2, priceScaleId: "right" });
      }
      const auData = auSeries.map((c) => ({ time: chartTime(c.time), value: c.au9999! }));
      instances.auLine.setData(auData);
    } else {
      if (instances.auLine) {
        priceChart.removeSeries(instances.auLine);
        instances.auLine = null;
      }
    }

    const barsData = visibleCandles.map((c) => ({
      time: chartTime(c.time),
      value: c.sentiment,
      color: c.sentiment > 0 ? "#d94b55" : c.sentiment < 0 ? "#31b978" : "#6d7683"
    }));
    bars.setData(barsData);

    priceChart.timeScale().fitContent();
    sentimentChart.timeScale().fitContent();
  }, [visibleCandles, unit, fxRate, showAuLine]);

  if (!candles.length) return <div className="empty-state">OANDA 蜡烛数据不可用，配置 token 后显示走势。</div>;

  return (
    <div className="price-module">
      <div className="chart-toolbar">
        <div className="chart-legend">
          <span><i className="legend-xau" />{xauLabel}</span>
          {showAuLine && <span><i className="legend-au" />AU9999（元/克）</span>}
          <span><i className="legend-event" />事件标记</span>
        </div>
        <div className="chart-controls">
          {(Object.keys(TIME_RANGE_MS) as TimeRange[]).map((item) => (
            <button className={item === range ? "active" : ""} key={item} onClick={() => setRange(item)}>{item}</button>
          ))}
          <span />
          {(["USD", "CNY"] as PriceUnit[]).map((item) => (
            <button className={item === unit ? "active" : ""} key={item} onClick={() => setUnit(item)}>{item}</button>
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

function filterCandles(candles: CandlePoint[], range: TimeRange) {
  if (!candles.length) return [];

  const end = new Date(candles.at(-1)!.time).getTime();
  const start = end - TIME_RANGE_MS[range];
  const filtered = candles.filter((candle) => new Date(candle.time).getTime() >= start);

  return filtered.length >= 2 ? filtered : candles.slice(-2);
}

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
      color: "#8c5bd6",
      shape: "circle" as const,
      text: String.fromCharCode(65 + index)
    }));
}
