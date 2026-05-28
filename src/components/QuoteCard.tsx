import { Info, AlertCircle } from "lucide-react";
import type { Quote } from "../types";
import { formatPct, formatQuoteValue, formatSigned } from "../utils/format";
import { marketTone, quoteMeta } from "../utils/market";

interface QuoteCardProps {
  quote?: Quote;
}

export function QuoteCard({ quote }: QuoteCardProps) {
  const meta = quoteMeta(quote?.symbol);
  const tone = marketTone(quote?.change);

  const getStatus = () => {
    const hasError = Boolean(quote?.error);

    if (!quote?.updatedAt) {
      return {
        text: "无历史序列",
        isStale: false,
        isError: hasError,
        tooltip: quote?.error || undefined
      };
    }

    const date = new Date(quote.updatedAt);
    if (!Number.isFinite(date.getTime())) {
      return {
        text: "无历史序列",
        isStale: false,
        isError: hasError,
        tooltip: quote?.error || undefined
      };
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const formattedTime = `${hours}:${minutes}:${seconds}`;

    // Stale if it is older than 30 seconds
    const isStale = Date.now() - date.getTime() > 30000;

    return {
      text: formattedTime,
      isStale: !hasError && isStale,
      isError: hasError,
      tooltip: quote?.error || (isStale ? "数据非实时 (延迟)" : undefined)
    };
  };

  const status = getStatus();

  return (
    <article className="metric-card">
      <div className="metric-copy">
        <div className="card-title">
          <div>
            <h3>{meta.title}</h3>
            <span>{meta.subtitle}</span>
          </div>
        </div>
        <strong className={tone}>{formatQuoteValue(quote)}</strong>
        <p className={tone}>
          {formatSigned(quote?.change, quote?.symbol)} <span>{formatPct(quote?.changePct, quote?.symbol)}</span>
        </p>
        <small>{meta.sourceLabel ?? quote?.source}</small>
      </div>
      <div className="metric-info" title={meta.description}>
        <Info size={14} />
      </div>
      <div className="metric-trend">
        <MiniSpark values={quote?.sparkline ?? []} down={Boolean(quote?.change && quote.change < 0)} />
        <div
          className={`trend-status ${status.isError ? "error" : ""} ${status.isStale ? "stale" : ""}`}
          title={status.tooltip}
        >
          {status.isError && <AlertCircle className="error-icon" size={12} />}
          {status.text}
        </div>
      </div>
    </article>
  );
}

function MiniSpark({ values, down }: { values: number[]; down: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 45 - ((value - min) / (max - min || 1)) * 34;
    return `${x},${y}`;
  });

  return (
    <svg className="spark" viewBox="0 0 100 50" preserveAspectRatio="none">
      <polyline points={points.join(" ")} fill="none" stroke={down ? "#31b978" : "#d94b55"} strokeWidth="2" />
    </svg>
  );
}
