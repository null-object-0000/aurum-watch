import type { DashboardPayload, TimeRange } from "../types";
import { EventFeed, Explanation, PredictionTable, SentimentGauge, Signal, SourceStatus } from "./dashboard-panels";
import { Panel } from "./Panel";
import { PriceChart } from "./PriceChart";
import { QuoteCard } from "./QuoteCard";

interface DashboardProps {
  data: DashboardPayload | null;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
}

export function Dashboard({ data, range, onRangeChange }: DashboardProps) {
  if (!data) return <div className="loading">正在连接真实数据源...</div>;

  const fxRate = data.quotes.find((quote) => quote.symbol === "USD_CNH")?.value ?? null;

  return (
    <div className="dashboard">
      <section className="metric-grid">
        {["XAU_USD", "AU9999", "USD_CNH", "XAU_CNY_G", "DOMESTIC_PREMIUM"].map((symbol) => (
          <QuoteCard key={symbol} quote={data.quotes.find((q) => q.symbol === symbol)} />
        ))}
      </section>
      <section className="content-grid">
        <Panel className="chart-panel chart-shell" title="金价走势" hint="真实行情">
          <PriceChart candles={data.candles} fxRate={fxRate} range={range} onRangeChange={onRangeChange} />
        </Panel>
        <Panel title="舆情影响强度" hint="综合">
          <SentimentGauge data={data} />
        </Panel>
        <Panel title="事件流" hint="最新" action="查看全部">
          <EventFeed events={data.events} />
        </Panel>
        <Panel title="信号结论">
          <Signal data={data} />
        </Panel>
        <Panel title="未来影响预测" hint="聚合预测">
          <PredictionTable data={data} />
        </Panel>
        <Panel title="模型解释" hint="为什么偏多？">
          <Explanation lines={data.explanation} />
        </Panel>
        <Panel title="数据源状态" action="详情">
          <SourceStatus sources={data.sources} />
        </Panel>
      </section>
    </div>
  );
}
