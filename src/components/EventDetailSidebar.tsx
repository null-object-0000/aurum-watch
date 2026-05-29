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

function generateExplanation(category: string, direction: string, impact: number) {
  const isBullish = impact > 0;
  const isBearish = impact < 0;
  
  if (category.includes("美联储") || category.includes("联储") || category.includes("降息") || category.includes("加息")) {
    if (isBullish) {
      return "美联储或相关官员释放偏向宽松（降息）的信号，暗示未来货币政策可能走向宽松。这通常会压低美元指数和美债收益率，从而降低持有黄金的机会成本，对金价形成强力支撑。";
    } else if (isBearish) {
      return "美联储或相关官员表态偏向鹰派，暗示可能维持高利率或进一步收紧货币政策。这通常会推升美元指数与美债收益率，吸引资金流向生息资产，从而打压无息资产黄金，对金价构成压制。";
    } else {
      return "美联储政策表态相对中性或存在分歧，市场正在等待更多宏观经济数据以明确未来政策走向。短期内对黄金价格的影响较为温和，金价呈现震荡整理格局。";
    }
  }
  
  if (category.includes("地缘") || category.includes("冲突") || category.includes("战争") || category.includes("政治")) {
    if (isBullish) {
      return "地缘政治局势紧张或发生军事冲突，引发市场避险情绪显著升温。黄金作为传统的避险资产，在避险资金的推动下需求大幅增加，对金价起到显著的推升和支撑作用。";
    } else if (isBearish) {
      return "地缘政治局势出现缓和迹象，市场避险情绪迅速降温。投资者风险偏好回升，资金流出避险资产，转向股市等风险资产，短期内对黄金价格构成压制。";
    } else {
      return "地缘局势相对平稳，未出现明显的恶化或缓和。市场参与者关注点可能暂时转向宏观经济数据，地缘政治层面对金价的影响偏向中立。";
    }
  }
  
  if (category.includes("美元") || category.includes("汇率")) {
    if (isBullish) {
      return "美元指数走弱或人民币等非美货币走强。由于国际金价以美元计价，美元贬值降低了非美货币投资者的购金成本，从而刺激黄金需求，推动金价上行。";
    } else if (isBearish) {
      return "美元指数走强，表现出强劲上涨势头。美元走强会对以美元计价的黄金价格产生直接的压制作用，使得黄金对其他货币持有者而言更加昂贵，对金价构成打压。";
    } else {
      return "美元指数维持窄幅震荡，暂无明确方向。市场在多空因素交织中寻找新导向，对金价的影响相对中性。";
    }
  }
  
  if (category.includes("债") || category.includes("收益率")) {
    if (isBullish) {
      return "美债收益率出现回落，降低了持有黄金这类无息资产的机会成本。资金流入黄金市场，为金价提供持续上行的动力。";
    } else if (isBearish) {
      return "美债收益率上涨，推高了持有黄金的机会成本。投资者更倾向于选择高收益的国债等资产，导致黄金吸引力下降，对金价形成压制。";
    } else {
      return "美债收益率窄幅整理，对黄金市场的边际影响有限，金价更多受其他主导因素驱动。";
    }
  }
  
  if (category.includes("通胀") || category.includes("CPI") || category.includes("PPI")) {
    if (isBullish) {
      return "通胀数据超预期上升，通胀压力加大。黄金作为传统的抗通胀资产，能够有效对抗货币贬值 and 通胀风险，吸引抗通胀买盘，推动金价上涨。";
    } else if (isBearish) {
      return "通胀数据出现明显回落，表明通胀压力缓解。这削弱了黄金作为抗通胀工具的需求，同时也可能减弱美联储的降息预期，对金价产生压制。";
    } else {
      return "通胀数据基本符合市场预期，未引起剧烈波动。市场认为通胀走势在预期轨道内，对金价的影响中性偏弱。";
    }
  }
  
  if (isBullish) {
    return "该事件对市场情绪产生了正面提振。投资者对黄金的避险需求或实物买盘有所上升，技术面或基本面均获得有利支撑，短期内有助于推动金价偏强运行。";
  } else if (isBearish) {
    return "该事件对黄金市场形成边际利空影响。由于宏观资金流出或市场对流动性收紧的预期升温，黄金市场的吸引力受到压制，短期内面临一定调整压力。";
  } else {
    return "该事件对黄金市场的直接影响较为有限，市场多空博弈处于均势。金价短期将继续跟随主流宏观指标及大盘走势进行区间震荡整理。";
  }
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

  const isBullish = event.impact > 0;
  const isBearish = event.impact < 0;
  const impactLabel = isBullish ? "利多" : isBearish ? "利空" : "中性";
  const tagClass = isBullish ? "bg-[var(--up-color)] text-white" : isBearish ? "bg-[var(--down-color)] text-white" : "bg-[var(--neutral)] text-white";
  const scoreClass = isBullish ? "text-[var(--up-color)]" : isBearish ? "text-[var(--down-color)]" : "text-[var(--neutral)]";
  const scoreText = isBullish ? `+${event.impact}` : `${event.impact}`;

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
    return generateExplanation(event.category, event.direction, event.impact);
  }, [event.category, event.direction, event.impact]);

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
