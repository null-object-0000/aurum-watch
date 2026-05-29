import React from "react";
import type { DashboardPayload, NewsEvent, TimeRange } from "../types";
import { EventFeed, Explanation, PredictionTable, SentimentGauge, Signal, SourceStatus } from "../components/dashboard-panels";
import { EventDetailSidebar } from "../components/EventDetailSidebar";
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
  const [sentimentRange, setSentimentRange] = React.useState<"1D" | "7D" | "30D">("1D");
  const [selectedEvent, setSelectedEvent] = React.useState<NewsEvent | null>(null);

  if (!data) return <div className="loading">{t("connectingData")}</div>;

  const fxRate = data.quotes.find((quote) => quote.symbol === "USD_CNH")?.value ?? null;

  // Custom action elements for panel headers
  const sentimentAction = (
    <div className="sentiment-range-switcher">
      {(["1D", "7D", "30D"] as const).map((r) => (
        <button
          key={r}
          className={`sentiment-range-btn ${sentimentRange === r ? "active" : ""}`}
          onClick={() => setSentimentRange(r)}
        >
          {r}
        </button>
      ))}
    </div>
  );

  const viewAllAction = (
    <button className="panel-header-link" onClick={() => { window.location.hash = "#/data"; }}>
      {t("viewAll")}
    </button>
  );

  const detailsAction = (
    <button className="panel-header-link" onClick={() => { window.location.hash = "#/settings"; }}>
      {t("details")} &gt;
    </button>
  );

  // Dynamic explanation hint based on short term prediction direction
  const explanationHint = data.predictions[0]?.direction === "bullish"
    ? t("whyBullish")
    : data.predictions[0]?.direction === "bearish"
      ? "为什么偏空？"
      : "为什么中性？";

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
        <Panel className="sentiment-panel" title={t("sentimentImpact")} hint={t("comprehensive")} action={sentimentAction}>
          <SentimentGauge data={data} range={sentimentRange} />
        </Panel>
        <Panel className="events-panel" title={t("eventFeed")} hint={t("latest")} action={viewAllAction}>
          <EventFeed
            events={data.events}
            onSelectEvent={(ev) => setSelectedEvent(selectedEvent?.id === ev.id ? null : ev)}
            selectedEventId={selectedEvent?.id}
          />
        </Panel>
        <Panel className="signal-panel" title={t("signalConclusion")}>
          <Signal data={data} />
        </Panel>
        <Panel className="prediction-panel" title={t("futureForecast")} hint="（聚合预测）">
          <PredictionTable data={data} />
        </Panel>
        <Panel className="explanation-panel" title={t("modelExplanation")} hint={`（${explanationHint}）`}>
          <Explanation lines={data.explanation} />
        </Panel>
        <Panel className="status-panel" title={t("dataSourceStatus")} action={detailsAction}>
          <SourceStatus sources={data.sources} />
        </Panel>
      </section>

      {selectedEvent && (
        <EventDetailSidebar
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}

