import React from "react";
import * as echarts from "echarts";
import type { DashboardPayload, NewsEvent } from "../types";
import { directionTone, marketTone } from "../utils/market";
import { usePreferences } from "../preferences";
import { useTranslation } from "react-i18next";

function mapCategoryName(name: string, t: any) {
  const mapping: Record<string, string> = {
    "地缘政治": "地缘政治",
    "美联储": "美联储政策",
    "美元": "美元指数",
    "美债": "美债收益率",
    "通胀": "通胀数据",
    "黄金市场": "央行购金"
  };
  return mapping[name] || name;
}

function getCategorySlug(category: string) {
  const mapping: Record<string, string> = {
    "地缘政治": "geopolitics",
    "美联储": "fed",
    "美元": "usd",
    "美债": "treasury",
    "通胀": "inflation",
    "黄金市场": "gold"
  };
  return mapping[category] || "default";
}

export function SentimentGauge({ data, range }: { data: DashboardPayload; range: "1D" | "7D" | "30D" }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  // Compute sentiment parameters based on range
  const sentiment = React.useMemo(() => {
    if (!data.events || !data.events.length) return data.sentiment;
    const days = range === "1D" ? 1 : range === "7D" ? 7 : 30;
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    const filteredEvents = data.events.filter((e) => new Date(e.time).getTime() >= cutoff);
    const analyzedEvents = filteredEvents.filter((e) => e.llmAnalyzed);
    const targetEvents = analyzedEvents.length ? analyzedEvents : filteredEvents;

    const bullish = targetEvents.filter((e) => e.impact > 0).reduce((sum, e) => sum + e.impact, 0);
    const bearish = Math.abs(targetEvents.filter((e) => e.impact < 0).reduce((sum, e) => sum + e.impact, 0));
    const score = Math.round((bullish - bearish) / Math.max(1, targetEvents.length));
    const neutralShare = targetEvents.length
      ? Math.round((targetEvents.filter((e) => e.direction === "neutral").length / targetEvents.length) * 100)
      : 0;

    const groups = new Map<string, number>();
    for (const event of targetEvents) {
      groups.set(event.category, (groups.get(event.category) ?? 0) + event.impact);
    }
    const factors = Array.from(groups.entries())
      .map(([name, value]) => ({ name, value: Math.max(-100, Math.min(100, Math.round(value))) }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 6);

    return {
      score,
      bullish: Math.round(bullish / Math.max(1, targetEvents.length)),
      bearish: -Math.round(bearish / Math.max(1, targetEvents.length)),
      neutralShare,
      factors
    };
  }, [data.events, data.sentiment, range]);

  React.useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const styles = getComputedStyle(document.documentElement);
    const upColor = styles.getPropertyValue("--up-color").trim() || "#d94b55";
    const downColor = styles.getPropertyValue("--down-color").trim() || "#31b978";
    const neutralColor = styles.getPropertyValue("--neutral").trim() || "#6d7683";

    chart.setOption({
      backgroundColor: "transparent",
      series: [{
        type: "gauge",
        min: -100,
        max: 100,
        startAngle: 200,
        endAngle: -20,
        radius: "95%",
        center: ["50%", "65%"],
        splitNumber: 5,
        axisLine: {
          lineStyle: {
            width: 12,
            color: [
              [0.4, downColor],
              [0.6, neutralColor],
              [1, upColor]
            ]
          }
        },
        pointer: { show: false },
        detail: { show: false },
        title: { show: false },
        progress: {
          show: true,
          width: 12,
          itemStyle: {
            color: sentiment.score >= 0 ? upColor : downColor
          }
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        data: [{ value: sentiment.score }]
      }]
    });
    return () => chart.dispose();
  }, [sentiment.score]);

  const scoreText = sentiment.score >= 0 ? `+${sentiment.score}` : `${sentiment.score}`;
  const directionText = sentiment.score > 12
    ? t("direction_bullish")
    : sentiment.score < -12
      ? t("direction_bearish")
      : t("direction_neutral");

  const scoreColor = sentiment.score > 12
    ? "var(--up-color)"
    : sentiment.score < -12
      ? "var(--down-color)"
      : "var(--neutral)";

  return (
    <div className="sentiment-module">
      <div className="gauge-relative-container">
        <div className="gauge-chart" ref={ref} />
        <div className="gauge-overlay-text">
          <span className="gauge-score" style={{ color: scoreColor }}>{scoreText}</span>
          <span className="gauge-direction" style={{ color: scoreColor }}>{directionText}</span>
          <span className="gauge-label">综合影响指数 (-100 ~ +100)</span>
        </div>
      </div>

      <div className="sentiment-stats">
        <span>
          {t("bullishStrength")}
          <b className="pos-text">+{sentiment.bullish}</b>
        </span>
        <span>
          {t("bearishStrength")}
          <b className="neg-text">{sentiment.bearish}</b>
        </span>
        <span>
          {t("neutralShare")}
          <b className="neutral-text">{sentiment.neutralShare}%</b>
        </span>
      </div>

      <div className="factor-header-title">
        分类影响强度 ({range})
      </div>
      <div className="factor-list">
        {sentiment.factors.map((factor) => {
          const displayVal = factor.value > 0 ? `+${factor.value}` : factor.value;
          const displayClass = factor.value > 0 ? "pos-text" : factor.value < 0 ? "neg-text" : "";
          const barClass = factor.value > 0 ? "pos-bar" : factor.value < 0 ? "neg-bar" : "neutral-bar";

          return (
            <div key={factor.name} className="factor-row">
              <span className="factor-name">{mapCategoryName(factor.name, t)}</span>
              <div className="factor-bar-wrapper">
                <div
                  className={`factor-bar ${barClass}`}
                  style={{ width: `${Math.min(100, Math.abs(factor.value))}%` }}
                />
              </div>
              <span className={`factor-value ${displayClass}`}>{displayVal}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EventFeed({
  events,
  onSelectEvent,
  selectedEventId
}: {
  events: NewsEvent[];
  onSelectEvent?: (event: NewsEvent) => void;
  selectedEventId?: string;
}) {
  const { t } = useTranslation();
  const [showNeutral, setShowNeutral] = React.useState(false);

  if (!events.length) return <div className="empty-state">{t("noEvents")}</div>;

  const isRealNeutral = (e: NewsEvent) => e.llmAnalyzed && e.direction === "neutral";
  const isUnanalyzed = (e: NewsEvent) => !e.llmAnalyzed;
  const relevantEvents = events.filter((e) => !isRealNeutral(e));
  const neutralCount = events.filter(isRealNeutral).length;
  const displayEvents = showNeutral ? events : relevantEvents;

  return (
    <div className="event-feed-redesign">
      <div className="event-feed-scroll">
        {displayEvents.map((event) => {
          const isUnanalyzed = !event.llmAnalyzed;
          const isBullish = event.impact > 0;
          const isBearish = event.impact < 0;
          const impactText = isUnanalyzed
            ? "待分析"
            : isBullish
              ? `利多 +${event.impact}`
              : isBearish
                ? `利空 ${event.impact}`
                : "中性";
          const impactClass = isUnanalyzed ? "neutral-text" : isBullish ? "pos-text" : isBearish ? "neg-text" : "neutral-text";
          const dotClass = isUnanalyzed ? "neutral" : event.direction === "bullish" ? "bullish" : event.direction === "bearish" ? "bearish" : "neutral";

          return (
            <a
              key={event.id}
              href={event.url || "#"}
              target="_blank"
              rel="noreferrer"
              className={`event-feed-item ${selectedEventId === event.id ? "active-event" : ""}`}
              onClick={(e) => {
                if (onSelectEvent) {
                  e.preventDefault();
                  onSelectEvent(event);
                }
              }}
            >
              <div className="event-item-top">
                <div className="event-item-meta">
                  <span className={`event-dot-marker ${dotClass}`} />
                  <time>{new Date(event.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
                  <span className="event-source-name">{event.source}</span>
                  {event.llmAnalyzed && <span className="event-llm-badge" title="LLM 分析">AI</span>}
                  <span className={`event-category-badge category-${getCategorySlug(event.category)}`}>
                    {mapCategoryName(event.category, t)}
                  </span>
                </div>
                <span className={`event-impact-score ${impactClass}`}>{impactText}</span>
              </div>
              <div className="event-item-title">{event.title}</div>
              <div className="event-item-desc">{event.summary || event.title}</div>
            </a>
          );
        })}
      </div>
      {neutralCount > 0 && (
        <button
          className="event-feed-toggle-neutral"
          onClick={() => setShowNeutral((v) => !v)}
        >
          {showNeutral
            ? `收起 ${neutralCount} 条中性事件`
            : `显示 ${neutralCount} 条中性事件`}
        </button>
      )}
    </div>
  );
}

export function Signal({ data }: { data: DashboardPayload }) {
  const { t } = useTranslation();
  const { resolvedLanguage } = usePreferences();

  const shortTerm = t("direction_" + data.predictions[0]?.direction);
  // Map neutral to "分歧" for medium-term in headline, as shown in mockup
  const mediumTerm = data.predictions[3]?.direction === "neutral"
    ? "分歧"
    : t("direction_" + data.predictions[3]?.direction);

  const headlineText = t("signalHeadline", { shortTerm, mediumTerm });
  const isBullish = data.predictions[0]?.direction === "bullish";
  const isBearish = data.predictions[0]?.direction === "bearish";
  const headlineClass = isBullish ? "pos-text" : isBearish ? "neg-text" : "neutral-text";

  return (
    <div className="signal-redesign">
      <h3 className={`signal-headline ${headlineClass}`}>{headlineText}</h3>
      <p className="signal-desc">{data.conclusion}</p>
      <div className="signal-footer">
        {t("updatedTime")}: {new Date(data.updatedAt).toLocaleString(resolvedLanguage, { hour12: false })}
      </div>
    </div>
  );
}

export function PredictionTable({ data }: { data: DashboardPayload }) {
  const { t } = useTranslation();
  return (
    <table className="prediction-table-redesign">
      <thead>
        <tr>
          <th>{t("horizon")}</th>
          <th>{t("bias")}</th>
          <th>{t("impactScore")}</th>
          <th>{t("confidence")}</th>
          <th>概率分布 (偏多 / 中性 / 偏空)</th>
          <th>因子分解 <span className="factor-hint-icon" title="各因子得分 -100~+100">ⓘ</span></th>
        </tr>
      </thead>
      <tbody>
        {data.predictions.map((row) => {
          const isBullish = row.direction === "bullish";
          const isBearish = row.direction === "bearish";
          const biasClass = isBullish ? "pos-text" : isBearish ? "neg-text" : "neutral-text";

          return (
            <tr key={row.horizon}>
              <td className="horizon-cell">{row.horizon}</td>
              <td className={`bias-cell ${biasClass}`}>{getDirectionLabel(row.direction, row.score, t)}</td>
              <td className={`score-cell ${row.score > 0 ? "pos-text" : row.score < 0 ? "neg-text" : ""}`}>
                {row.score > 0 ? `+${row.score}` : row.score}
              </td>
              <td className="confidence-cell">{row.confidence}%</td>
              <td className="prob-cell"><Probability probs={row.probabilities} /></td>
              <td className="factor-cell">
                {row.factorBreakdown ? (
                  <span className="factor-tooltip-trigger" title={
                    `技术面: ${row.factorBreakdown.technical > 0 ? "+" : ""}${row.factorBreakdown.technical} (权重 ${(row.factorBreakdown.weights.technical * 100).toFixed(0)}%)
价差面: ${row.factorBreakdown.premium > 0 ? "+" : ""}${row.factorBreakdown.premium} (权重 ${(row.factorBreakdown.weights.premium * 100).toFixed(0)}%)
情绪面: ${row.factorBreakdown.sentiment > 0 ? "+" : ""}${row.factorBreakdown.sentiment} (权重 ${(row.factorBreakdown.weights.sentiment * 100).toFixed(0)}%)`
                  }>
                    <span className={`factor-dot ${row.factorBreakdown.technical > 0 ? "pos" : row.factorBreakdown.technical < 0 ? "neg" : ""}`}>T</span>
                    <span className={`factor-dot ${row.factorBreakdown.premium > 0 ? "pos" : row.factorBreakdown.premium < 0 ? "neg" : ""}`}>P</span>
                    <span className={`factor-dot ${row.factorBreakdown.sentiment > 0 ? "pos" : row.factorBreakdown.sentiment < 0 ? "neg" : ""}`}>S</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">-</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function getDirectionLabel(direction: string, score: number, t: any) {
  if (direction === "neutral") {
    if (score > 15) return "中性偏多";
    if (score < -15) return "中性偏空";
    return t("direction_neutral");
  }
  return t("direction_" + direction);
}

function Probability({ probs }: { probs: { bullish: number; neutral: number; bearish: number } }) {
  return (
    <div className="prob-progress-bar">
      {probs.bullish > 0 && (
        <div className="prob-segment segment-bullish" style={{ width: `${probs.bullish}%` }}>
          {probs.bullish}%
        </div>
      )}
      {probs.neutral > 0 && (
        <div className="prob-segment segment-neutral" style={{ width: `${probs.neutral}%` }}>
          {probs.neutral}%
        </div>
      )}
      {probs.bearish > 0 && (
        <div className="prob-segment segment-bearish" style={{ width: `${probs.bearish}%` }}>
          {probs.bearish}%
        </div>
      )}
    </div>
  );
}

export function Explanation({ lines }: { lines: string[] }) {
  return (
    <div className="explanation-container">
      <ul className="explain-list">
        {lines.map((line) => (
          <li key={line} className="explain-item">
            <span className="explain-checkmark">✓</span>
            <span className="explain-text">{line}</span>
          </li>
        ))}
      </ul>
      <div className="explanation-footer-note">
        注: 以上为模型基于当前数据的综合分析，仅供参考。
      </div>
    </div>
  );
}

export function SourceStatus({ sources }: { sources: DashboardPayload["sources"] }) {
  const { t } = useTranslation();
  return (
    <div className="sources-grid">
      {sources.map((source) => {
        const displayName = source.name === "News"
          ? "News"
          : source.name === "Database"
            ? "Database"
            : source.name;

        return (
          <div key={source.name} className="source-item-row">
            <span className="source-name-label">{displayName}</span>
            <div className="source-status-info">
              <span className={`status-dot-indicator ${source.status}`} />
              <strong className="source-status-text">{t("status_" + source.status)}</strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}
