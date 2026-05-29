import type { DashboardPayload, TimeRange } from "../types";
import { EventFeed, Explanation, PredictionTable, SentimentGauge, Signal, SourceStatus } from "./dashboard-panels";
import { Panel } from "./Panel";
import { PriceChart } from "./PriceChart";
import { QuoteCard } from "./QuoteCard";
import { usePreferences } from "../preferences";

interface DashboardProps {
  data: DashboardPayload | null;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
}

export function Dashboard({ data, range, onRangeChange }: DashboardProps) {
  const { resolvedLanguage } = usePreferences();
  const tr = (zh: string, en: string) => resolvedLanguage === "zh-CN" ? zh : en;
  if (!data) return <div className="loading">{tr("正在连接真实数据源...", "Connecting to market data...")}</div>;

  const fxRate = data.quotes.find((quote) => quote.symbol === "USD_CNH")?.value ?? null;

  return (
    <div className="dashboard">
      <section className="metric-grid">
        {["XAU_USD", "AU9999", "USD_CNH", "XAU_CNY_G", "DOMESTIC_PREMIUM"].map((symbol) => (
          <QuoteCard key={symbol} quote={data.quotes.find((q) => q.symbol === symbol)} />
        ))}
      </section>
      <section className="content-grid">
        <Panel className="chart-panel chart-shell" title={tr("金价走势", "Gold Price")} hint={tr("真实行情", "Market data")}>
          <PriceChart candles={data.candles} fxRate={fxRate} range={range} onRangeChange={onRangeChange} />
        </Panel>
        <Panel title={tr("舆情影响强度", "Sentiment Impact")} hint={tr("综合", "Aggregate")}>
          <SentimentGauge data={data} />
        </Panel>
        <Panel title={tr("事件流", "Event Feed")} hint={tr("最新", "Latest")} action={tr("查看全部", "View all")}>
          <EventFeed events={data.events} />
        </Panel>
        <Panel title={tr("信号结论", "Signal")}>
          <Signal data={data} />
        </Panel>
        <Panel title={tr("未来影响预测", "Forecast")} hint={tr("聚合预测", "Aggregate")}>
          <PredictionTable data={data} />
        </Panel>
        <Panel title={tr("模型解释", "Explanation")} hint={tr("为什么偏多？", "Drivers")}>
          <Explanation lines={data.explanation} />
        </Panel>
        <Panel title={tr("数据源状态", "Sources")} action={tr("详情", "Details")}>
          <SourceStatus sources={data.sources} />
        </Panel>
      </section>
    </div>
  );
}
