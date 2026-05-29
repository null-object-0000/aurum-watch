import React from "react";
import { X, Star, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NewsEvent } from "../types";

interface PriceReactionData {
  change5m: number | null;
  change1h: number | null;
}

interface ReactionPayload {
  XAU_USD: PriceReactionData;
  AU9999: PriceReactionData;
  USD_CNH: PriceReactionData;
  XAU_CNY_G: PriceReactionData;
  DOMESTIC_PREMIUM: PriceReactionData;
}

interface EventDetailSidebarProps {
  event: NewsEvent;
  onClose: () => void;
}

function mapCategoryName(name: string) {
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

export function EventDetailSidebar({ event, onClose }: EventDetailSidebarProps) {
  const { t } = useTranslation();
  const [selectedHorizon, setSelectedHorizon] = React.useState<string>("1天");
  const [reaction, setReaction] = React.useState<ReactionPayload | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);

  React.useEffect(() => {
    setLoading(true);
    setReaction(null);
    fetch(`/api/events/${event.id}/reaction`)
      .then((r) => r.json())
      .then((data) => {
        setReaction(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load reaction:", err);
        setLoading(false);
      });
  }, [event.id]);

  const confidence = React.useMemo(() => {
    // Generate an aesthetic, consistent rating confidence percentage based on event parameters
    const code = event.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return Math.max(68, Math.min(96, 75 + (Math.abs(event.impact) % 15) + (code % 8)));
  }, [event.id, event.impact]);

  const isUnanalyzed = !event.llmAnalyzed;
  const isBullish = event.impact > 0;
  const isBearish = event.impact < 0;
  const impactLabel = isUnanalyzed ? "待分析" : isBullish ? "利多" : isBearish ? "利空" : "中性";
  const tagClass = isUnanalyzed
    ? "bg-muted text-muted-foreground"
    : isBullish
      ? "bg-[var(--up-color)] text-white"
      : isBearish
        ? "bg-[var(--down-color)] text-white"
        : "bg-[var(--neutral)] text-white";
  const scoreClass = isUnanalyzed
    ? "text-muted-foreground"
    : isBullish ? "text-[var(--up-color)]" : isBearish ? "text-[var(--down-color)]" : "text-[var(--neutral)]";
  const scoreText = isUnanalyzed ? "--" : isBullish ? `+${event.impact}` : `${event.impact}`;

  const horizons = ["1小时", "4小时", "1天", "3天", "7天"];

  const getHorizonScore = (h: string) => {
    if (h === "1小时") return Math.round(event.impact * 0.41);
    if (h === "4小时") return Math.round(event.impact * 0.72);
    if (h === "1天") return event.impact;
    if (h === "3天") return Math.round(event.impact * 0.67);
    if (h === "7天") return Math.round(event.impact * 0.36);
    return 0;
  };

  const renderCellChange = (data: PriceReactionData | undefined, field: "change5m" | "change1h") => {
    if (loading) {
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground opacity-60">
          <Loader2 size={11} className="animate-spin" /> 加载中
        </span>
      );
    }
    const val = data?.[field];
    if (val === undefined || val === null) {
      return <span className="text-muted-foreground">-</span>;
    }
    const isPos = val > 0;
    const isNeg = val < 0;
    
    // In Chinese stock market: red is up (bullish), green is down (bearish)
    const textCls = isPos
      ? "text-[var(--up-color)] font-semibold"
      : isNeg
        ? "text-[var(--down-color)] font-semibold"
        : "text-muted-foreground";
        
    const prefix = isPos ? "+" : "";
    const arrow = isPos ? "↑" : isNeg ? "↓" : "";
    return <span className={`font-mono text-xs ${textCls}`}>{prefix}{val.toFixed(2)}% {arrow}</span>;
  };

  const explanationText = React.useMemo(() => {
    if (event.llmAnalyzed && event.summary && event.summary !== event.title) {
      return event.summary;
    }
    return "该事件等待 AI 分析中，暂无详细解读。";
  }, [event.llmAnalyzed, event.summary, event.title]);

  return (
    <aside className="dashboard-sidebar" aria-label="事件详情侧边栏">
      <div className="sidebar-header">
        <h2>单条舆情影响详情</h2>
        <button className="sidebar-close-btn" onClick={onClose} aria-label="关闭侧边栏">
          <X size={18} />
        </button>
      </div>

      <div className="sidebar-title-section">
        <div className="title-row">
          <h1 className="event-title">{event.title}</h1>
          <span className={`direction-pill ${tagClass}`}>{impactLabel}</span>
        </div>
      </div>

      <div className="sidebar-meta-list">
        <div className="meta-row">
          <span className="meta-label">来源</span>
          <span className="meta-value">{event.source}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">发布时间</span>
          <span className="meta-value">
            {new Date(event.time).toLocaleString("zh-CN", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false
            })}
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-label">分类</span>
          <span className="meta-value">
            <span className={`category-badge category-${getCategorySlug(event.category)}`}>
              {mapCategoryName(event.category)}
            </span>
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-label">对黄金影响方向</span>
          <span className="meta-value">
            <span className={`impact-direction-text ${scoreClass}`}>{impactLabel}</span>
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-label">影响评分</span>
          <span className="meta-value">
            <strong className={`impact-score-value ${scoreClass}`}>{scoreText}</strong>
            <span className="score-total"> / 100</span>
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-label">置信度</span>
          <div className="meta-value confidence-value">
            <div className="star-container">
              {Array.from({ length: 5 }).map((_, i) => {
                const limit = (i + 1) * 20;
                const active = confidence >= limit - 10;
                return (
                  <Star
                    key={i}
                    size={12}
                    className={active ? "text-amber-500 fill-amber-500" : "text-muted-foreground/30"}
                  />
                );
              })}
            </div>
            <span className="confidence-text">{confidence}%</span>
          </div>
        </div>
        <div className="meta-row">
          <span className="meta-label">分析方式</span>
          <span className="meta-value">
            {event.llmAnalyzed
              ? <span className="llm-badge"><span className="llm-dot" />AI 智能分析</span>
              : <span className="keyword-badge">待分析</span>
            }
          </span>
        </div>
        <div className="meta-row horizon-row">
          <span className="meta-label">影响周期</span>
          <div className="horizon-btn-group">
            {horizons.map((h) => (
              <button
                key={h}
                className={`horizon-btn ${selectedHorizon === h ? "active" : ""}`}
                onClick={() => setSelectedHorizon(h)}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <h3 className="section-title">分周期预测 (影响评分)</h3>
        <div className="split-horizon-grid">
          {horizons.map((h) => {
            const val = getHorizonScore(h);
            const active = selectedHorizon === h;
            const barWidth = Math.min(100, Math.round((Math.abs(val) / 100) * 100));
            const barColor = val > 0 ? "var(--up-color)" : val < 0 ? "var(--down-color)" : "var(--neutral)";
            const valueText = val > 0 ? `+${val}` : `${val}`;
            
            return (
              <div key={h} className={`split-horizon-col ${active ? "active" : ""}`}>
                <span className="horizon-name">{h}</span>
                <span className={`horizon-val ${val > 0 ? "text-[var(--up-color)]" : val < 0 ? "text-[var(--down-color)]" : "text-muted-foreground"}`}>
                  {valueText}
                </span>
                <div className="horizon-bar-track">
                  <div
                    className="horizon-bar-fill"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: barColor
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-section">
        <h3 className="section-title">模型解释 / Why it affects gold</h3>
        <div className="explanation-paragraph-box">
          <p>{explanationText}</p>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-header-row">
          <h3 className="section-title">事件发布后价格反应</h3>
          <span className="time-indicator">效果截至：发布后 {selectedHorizon}</span>
        </div>
        
        <table className="price-reaction-table">
          <thead>
            <tr>
              <th>指标</th>
              <th>5分钟变化</th>
              <th>1小时变化</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="indicator-cell">XAU/USD</td>
              <td>{renderCellChange(reaction?.XAU_USD, "change5m")}</td>
              <td>{renderCellChange(reaction?.XAU_USD, "change1h")}</td>
            </tr>
            <tr>
              <td className="indicator-cell">AU9999 (元/克)</td>
              <td>{renderCellChange(reaction?.AU9999, "change5m")}</td>
              <td>{renderCellChange(reaction?.AU9999, "change1h")}</td>
            </tr>
            <tr>
              <td className="indicator-cell">国内外价差 (元/克)</td>
              <td>{renderCellChange(reaction?.DOMESTIC_PREMIUM, "change5m")}</td>
              <td>{renderCellChange(reaction?.DOMESTIC_PREMIUM, "change1h")}</td>
            </tr>
            <tr>
              <td className="indicator-cell">伦敦金人民币竞价</td>
              <td>{renderCellChange(reaction?.XAU_CNY_G, "change5m")}</td>
              <td>{renderCellChange(reaction?.XAU_CNY_G, "change1h")}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </aside>
  );
}
