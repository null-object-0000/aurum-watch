import type { DashboardPayload, TimeRange } from "../types";
import { EventFeed, Explanation, PredictionTable, SentimentGauge, Signal, SourceStatus } from "../components/dashboard-panels";
import { Panel } from "../components/Panel";
import { PriceChart } from "../components/PriceChart";
import { QuoteCard } from "../components/QuoteCard";
import { useTranslation } from "react-i18next";

interface DashboardProps {
  data: DashboardPayload | null;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
}

export function Dashboard({ data, range, onRangeChange }: DashboardProps) {
  const { t } = useTranslation();
  if (!data) return <div className="loading">{t("connectingData")}</div>;

  const fxRate = data.quotes.find((quote) => quote.symbol === "USD_CNH")?.value ?? null;

  return (
    <div className="dashboard">
      <section className="metric-grid">
        {["XAU_USD", "AU9999", "USD_CNH", "XAU_CNY_G", "DOMESTIC_PREMIUM"].map((symbol) => (
          <QuoteCard key={symbol} quote={data.quotes.find((q) => q.symbol === symbol)} />
        ))}
      </section>
      <section className="content-grid">
        <Panel className="chart-panel chart-shell" title={t("goldPriceTrend")} hint={t("realtimeMarket")}>
          <PriceChart candles={data.candles} fxRate={fxRate} range={range} onRangeChange={onRangeChange} />
        </Panel>
        <Panel title={t("sentimentImpact")} hint={t("comprehensive")}>
          <SentimentGauge data={data} />
        </Panel>
        <Panel title={t("eventFeed")} hint={t("latest")} action={t("viewAll")}>
          <EventFeed events={data.events} />
        </Panel>
        <Panel title={t("signalConclusion")}>
          <Signal data={data} />
        </Panel>
        <Panel title={t("futureForecast")} hint={t("comprehensive")}>
          <PredictionTable data={data} />
        </Panel>
        <Panel title={t("modelExplanation")} hint={t("whyBullish")}>
          <Explanation lines={data.explanation} />
        </Panel>
        <Panel title={t("dataSourceStatus")} action={t("details")}>
          <SourceStatus sources={data.sources} />
        </Panel>
      </section>
    </div>
  );
}
