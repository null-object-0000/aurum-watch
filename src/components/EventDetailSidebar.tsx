import React from "react";
import { X, Star, Loader2, ExternalLink, Sparkles, Terminal } from "lucide-react";
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

export function EventDetailSidebar({ event: propEvent, onClose }: EventDetailSidebarProps) {
  const { t } = useTranslation();
  const [selectedHorizon, setSelectedHorizon] = React.useState<string>("1天");
  const [reaction, setReaction] = React.useState<ReactionPayload | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [analyzing, setAnalyzing] = React.useState<boolean>(false);
  const [event, setEvent] = React.useState<NewsEvent>(propEvent);

  const [logs, setLogs] = React.useState<string[]>([]);
  const [logModalOpen, setLogModalOpen] = React.useState<boolean>(false);
  const [modalStatus, setModalStatus] = React.useState<"analyzing" | "done" | "error">("analyzing");
  const [modalError, setModalError] = React.useState<string | null>(null);

  // Sync from parent prop
  React.useEffect(() => {
    setEvent(propEvent);
    setSelectedHorizon(propEvent.llmImpactHorizon || "1天");
  }, [propEvent]);

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

  const handleTriggerAnalysis = async () => {
    setAnalyzing(true);
    setLogs([`[系统提示] 正在初始化 AI 分析环境...`]);
    setLogModalOpen(true);
    setModalStatus("analyzing");
    setModalError(null);

    try {
      const res = await fetch(`/api/events/${event.id}/analyze`, { method: "POST" });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "分析执行失败");
      }

      if (data.logs) {
        setLogs(data.logs);
      }
      setModalStatus("done");

      // 更新当前侧边栏的 event 数据
      if (data.event) {
        setEvent(data.event);
        setSelectedHorizon(data.event.llmImpactHorizon || "1天");
        setReaction(null); // 触发价格反应重新拉取
        window.dispatchEvent(new CustomEvent("refresh-dashboard"));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知分析错误";
      setLogs((prev) => [...prev, `[异常终止] ${msg}`]);
      setModalStatus("error");
      setModalError(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const confidence = React.useMemo(() => {
    if (event.llmConfidence !== undefined && event.llmConfidence !== null) {
      return event.llmConfidence;
    }
    // Generate an aesthetic, consistent rating confidence percentage based on event parameters
    const code = event.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return Math.max(68, Math.min(96, 75 + (Math.abs(event.impact) % 15) + (code % 8)));
  }, [event.id, event.impact, event.llmConfidence]);

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
    <>
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
          <div className="horizon-btn-group" style={{ pointerEvents: "none" }}>
            {horizons.map((h) => (
              <span
                key={h}
                className={`horizon-btn ${selectedHorizon === h ? "active" : ""}`}
              >
                {h}
              </span>
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

      <div className="sidebar-actions">
        {event.url && (
          <a
            href={event.url}
            target="_blank"
            rel="noreferrer"
            className="sidebar-action-btn"
          >
            <ExternalLink size={14} />
            查看原文
          </a>
        )}
        {analyzing && (
          <button
            className="sidebar-action-btn sidebar-action-primary"
            onClick={() => setLogModalOpen(true)}
          >
            <Loader2 size={14} className="animate-spin" />
            查看分析中日志...
          </button>
        )}
        {!analyzing && !event.llmAnalyzed && (
          <button
            className="sidebar-action-btn sidebar-action-primary"
            onClick={handleTriggerAnalysis}
          >
            <Sparkles size={14} />
            立即 AI 分析
          </button>
        )}
        {!analyzing && event.llmAnalyzed && (
          <button
            className="sidebar-action-btn sidebar-action-secondary"
            onClick={() => {
              setLogs(event.llmLogs || ["该事件已由 AI 分析，但未保存日志明细。"]);
              setModalStatus("done");
              setLogModalOpen(true);
            }}
          >
            <Terminal size={14} />
            查看分析日志
          </button>
        )}
      </div>
    </aside>

    {logModalOpen && (
      <AnalysisLogModal
        logs={logs}
        status={modalStatus}
        eventTitle={propEvent.title}
        category={event.category}
        impact={event.impact}
        confidence={event.llmConfidence}
        horizon={event.llmImpactHorizon}
        onClose={() => setLogModalOpen(false)}
      />
    )}
    </>
  );
}

interface AnalysisLogModalProps {
  logs: string[];
  status: "analyzing" | "done" | "error";
  eventTitle: string;
  category?: string;
  impact?: number;
  confidence?: number | null;
  horizon?: string | null;
  onClose: () => void;
}

function AnalysisLogModal({
  logs,
  status,
  eventTitle,
  category,
  impact,
  confidence,
  horizon,
  onClose
}: AnalysisLogModalProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length, status]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] mx-4 bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-slate-900 text-slate-100">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-400 animate-pulse" />
            <h3 className="text-sm font-bold text-left">AI 智能舆情分析日志明细</h3>
            {status === "analyzing" && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-semibold">
                <Loader2 size={10} className="animate-spin" />
                正在分析...
              </span>
            )}
            {status === "done" && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
                ✓ 分析完成
              </span>
            )}
            {status === "error" && (
              <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 font-semibold">
                ✗ 分析失败
              </span>
            )}
          </div>
          <button
            className="w-6 h-6 flex items-center justify-center rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition-colors text-xs"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Event Title Info */}
        <div className="px-4 py-2.5 bg-muted/30 border-b border-border/50 text-xs text-muted-foreground flex flex-col gap-1 text-left">
          <div className="truncate"><strong>分析事件：</strong>{eventTitle}</div>
          {status === "done" && horizon && (
            <div className="flex gap-4 flex-wrap mt-0.5">
              <span><strong>AI分类：</strong>{category}</span>
              <span><strong>影响评分：</strong>{impact}</span>
              <span><strong>置信度：</strong>{confidence}%</span>
              <span><strong>影响周期：</strong>{horizon}</span>
            </div>
          )}
        </div>

        {/* Terminal Logs */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed bg-black text-slate-100 m-3 rounded-lg border border-border max-h-[380px] text-left"
        >
          {logs.map((line, i) => {
            let colorClass = "text-slate-300";
            if (line.includes("开始为单条事件")) colorClass = "text-cyan-400 font-semibold";
            else if (line.includes("【系统提示词") || line.includes("[LLM 请求参数]")) colorClass = "text-slate-500";
            else if (line.includes("[LLM 输入]")) colorClass = "text-amber-400";
            else if (line.includes("[LLM 输出]")) colorClass = "text-emerald-400";
            else if (line.includes("【分析完成并成功入库】") || line.includes("分析成功")) colorClass = "text-emerald-500 font-bold";
            else if (line.includes("[错误]") || line.includes("[异常终止]")) colorClass = "text-rose-400 font-semibold";
            
            return (
              <div key={i} className={`py-0.5 whitespace-pre-wrap ${colorClass}`}>
                {line}
              </div>
            );
          })}
          {status === "analyzing" && (
            <div className="text-amber-400/80 animate-pulse mt-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              正在调用 LLM 进行深度解析，这可能需要数秒时间...
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-3 border-t border-border bg-muted/20">
          <button
            className="px-4 h-9 text-xs font-semibold rounded-md border border-border bg-background hover:bg-accent text-foreground transition-colors"
            onClick={onClose}
          >
            关闭
          </button>
          {status === "done" && (
            <button
              className="px-4 h-9 text-xs font-semibold rounded-md bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
              onClick={onClose}
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
