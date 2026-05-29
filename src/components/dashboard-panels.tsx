import React from "react";
import { Shield } from "lucide-react";
import * as echarts from "echarts";
import type { DashboardPayload, NewsEvent } from "../types";
import { directionText, directionTone, marketTone, statusLabel } from "../utils/market";
import { usePreferences } from "../preferences";

export function SentimentGauge({ data }: { data: DashboardPayload }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { resolvedLanguage } = usePreferences();
  const tr = (zh: string, en: string) => resolvedLanguage === "zh-CN" ? zh : en;

  React.useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const styles = getComputedStyle(document.documentElement);
    const upColor = styles.getPropertyValue("--up-color").trim() || "#d94b55";
    const downColor = styles.getPropertyValue("--down-color").trim() || "#31b978";
    chart.setOption({
      backgroundColor: "transparent",
      series: [{
        type: "gauge",
        min: -100,
        max: 100,
        splitNumber: 4,
        axisLine: { lineStyle: { width: 18, color: [[0.35, downColor], [0.5, "#6d7683"], [1, upColor]] } },
        pointer: { show: false },
        progress: { show: true, width: 18 },
        detail: { valueAnimation: true, formatter: "{value}", color: data.sentiment.score >= 0 ? upColor : downColor, fontSize: 36, offsetCenter: [0, "10%"] },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        data: [{ value: data.sentiment.score }]
      }]
    });
    return () => chart.dispose();
  }, [data.sentiment.score]);

  return (
    <div>
      <div className="gauge" ref={ref} />
      <div className="sentiment-stats">
        <span>{tr("利多强度", "Bullish")} <b className="red">+{data.sentiment.bullish}</b></span>
        <span>{tr("利空强度", "Bearish")} <b className="green">{data.sentiment.bearish}</b></span>
        <span>{tr("中性占比", "Neutral")} <b>{data.sentiment.neutralShare}%</b></span>
      </div>
      <div className="factor-list">
        {data.sentiment.factors.map((factor) => (
          <div key={factor.name}>
            <span>{factor.name}</span>
            <i><b style={{ width: `${Math.min(100, Math.abs(factor.value))}%` }} className={factor.value >= 0 ? "pos" : "neg"} /></i>
            <em className={marketTone(factor.value)}>{factor.value > 0 ? "+" : ""}{factor.value}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EventFeed({ events }: { events: NewsEvent[] }) {
  const { resolvedLanguage } = usePreferences();
  if (!events.length) return <div className="empty-state">{resolvedLanguage === "zh-CN" ? "GDELT 新闻源暂未返回事件。" : "No GDELT events yet."}</div>;

  return (
    <div className="event-feed">
      {events.slice(0, 6).map((event) => (
        <a key={event.id} href={event.url} target="_blank" rel="noreferrer">
          <span className={`event-dot ${event.direction}`} />
          <time>{new Date(event.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
          <small>{event.source}</small>
          <strong>{event.title}</strong>
          <em>{event.category}</em>
          <b className={marketTone(event.impact)}>{event.impact > 0 ? "+" : ""}{event.impact}</b>
        </a>
      ))}
    </div>
  );
}

export function Signal({ data }: { data: DashboardPayload }) {
  const { resolvedLanguage } = usePreferences();
  const tr = (zh: string, en: string) => resolvedLanguage === "zh-CN" ? zh : en;
  return (
    <div className="signal">
      <h3 className={directionTone(data.predictions[0]?.direction)}>{directionText(data.predictions[0]?.direction)}，中期{directionText(data.predictions[3]?.direction)}</h3>
      <p>{data.conclusion}</p>
      <small>{tr("更新时间", "Updated")}: {new Date(data.updatedAt).toLocaleString(resolvedLanguage, { hour12: false })}</small>
    </div>
  );
}

export function PredictionTable({ data }: { data: DashboardPayload }) {
  const { resolvedLanguage } = usePreferences();
  const tr = (zh: string, en: string) => resolvedLanguage === "zh-CN" ? zh : en;
  return (
    <table className="prediction">
      <thead><tr><th>{tr("周期", "Horizon")}</th><th>{tr("方向", "Bias")}</th><th>{tr("影响评分", "Score")}</th><th>{tr("置信度", "Confidence")}</th><th>{tr("概率分布", "Distribution")}</th></tr></thead>
      <tbody>
        {data.predictions.map((row) => (
          <tr key={row.horizon}>
            <td>{row.horizon}</td>
            <td className={directionTone(row.direction)}>{directionText(row.direction)}</td>
            <td>{row.score > 0 ? "+" : ""}{row.score}</td>
            <td>{row.confidence}%</td>
            <td><Probability probs={row.probabilities} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Explanation({ lines }: { lines: string[] }) {
  return <ul className="explain">{lines.map((line) => <li key={line}><Shield size={15} />{line}</li>)}</ul>;
}

export function SourceStatus({ sources }: { sources: DashboardPayload["sources"] }) {
  return (
    <div className="sources">
      {sources.map((source) => (
        <div key={source.name}>
          <span>{source.name}</span>
          <b className={`dot ${source.status}`} />
          <strong>{statusLabel(source.status)}</strong>
        </div>
      ))}
    </div>
  );
}

function Probability({ probs }: { probs: { bullish: number; neutral: number; bearish: number } }) {
  return (
    <div className="prob">
      <span style={{ width: `${probs.bullish}%` }}>{probs.bullish}%</span>
      <span style={{ width: `${probs.neutral}%` }}>{probs.neutral}%</span>
      <span style={{ width: `${probs.bearish}%` }}>{probs.bearish}%</span>
    </div>
  );
}
