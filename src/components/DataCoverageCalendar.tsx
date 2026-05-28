import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface DayCoverage {
  day: string;
  minuteCount: number;
  coveragePct: number;
}

interface MonthCoverage {
  month: string;
  minuteCount: number;
  coveragePct: number;
}

type ViewMode = "month" | "year";

const SYMBOLS = [
  { id: "XAU_USD", label: "XAU/USD" },
  { id: "AU9999",  label: "AU9999" },
  { id: "USD_CNH", label: "USD/CNH" }
];

const MONTH_NAMES = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
const DAY_LABELS  = ["一","二","三","四","五","六","日"];

// ─── Coverage Color ────────────────────────────────────────────────────────

function coverageColor(pct: number, isWeekend = false): string {
  if (isWeekend) return "rgba(255,255,255,0.03)";
  if (pct === 0)   return "rgba(255,255,255,0.04)";
  if (pct < 25)    return "rgba(217,75,85,0.35)";
  if (pct < 50)    return "rgba(217,75,85,0.6)";
  if (pct < 75)    return "rgba(226,177,60,0.55)";
  if (pct < 95)    return "rgba(49,185,120,0.45)";
  return "rgba(49,185,120,0.85)";
}

function coverageBorder(pct: number): string {
  if (pct === 0)   return "transparent";
  if (pct < 25)    return "rgba(217,75,85,0.3)";
  if (pct < 75)    return "rgba(226,177,60,0.3)";
  return "rgba(49,185,120,0.3)";
}

// ─── Component ─────────────────────────────────────────────────────────────

export function DataCoverageCalendar() {
  const [viewMode, setViewMode] = React.useState<ViewMode>("month");
  const [symbol, setSymbol] = React.useState("XAU_USD");
  const [year, setYear] = React.useState(new Date().getFullYear());
  const [month, setMonth] = React.useState(new Date().getMonth() + 1);

  const [dailyData, setDailyData]   = React.useState<DayCoverage[]>([]);
  const [monthlyData, setMonthlyData] = React.useState<MonthCoverage[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    loadData();
  }, [symbol, year, month, viewMode]);

  async function loadData() {
    setLoading(true);
    try {
      if (viewMode === "month") {
        const res = await fetch(`/api/settings/data/coverage?symbol=${symbol}&year=${year}&month=${month}`);
        setDailyData(await res.json());
      } else {
        const res = await fetch(`/api/settings/data/coverage?symbol=${symbol}&year=${year}`);
        setMonthlyData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }

  function prevPeriod() {
    if (viewMode === "month") {
      if (month === 1) { setMonth(12); setYear(y => y - 1); }
      else setMonth(m => m - 1);
    } else {
      setYear(y => y - 1);
    }
  }

  function nextPeriod() {
    if (viewMode === "month") {
      if (month === 12) { setMonth(1); setYear(y => y + 1); }
      else setMonth(m => m + 1);
    } else {
      setYear(y => y + 1);
    }
  }

  const title = viewMode === "month"
    ? `${year} 年 ${MONTH_NAMES[month - 1]}`
    : `${year} 年`;

  return (
    <div className="coverage-calendar">
      {/* Header */}
      <div className="coverage-header">
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            className="form-select"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{ width: "auto" }}
          >
            {SYMBOLS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <div className="coverage-view-toggle">
            <button
              className={`coverage-view-btn${viewMode === "month" ? " active" : ""}`}
              onClick={() => setViewMode("month")}
            >月视图</button>
            <button
              className={`coverage-view-btn${viewMode === "year" ? " active" : ""}`}
              onClick={() => setViewMode("year")}
            >年视图</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="coverage-nav-btn" onClick={prevPeriod}>
            <ChevronLeft size={14} />
          </button>
          <span className="coverage-title">{title}</span>
          <button className="coverage-nav-btn" onClick={nextPeriod}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="coverage-legend">
        {[
          { color: "rgba(255,255,255,0.04)", label: "无数据" },
          { color: "rgba(217,75,85,0.6)",   label: "< 50%" },
          { color: "rgba(226,177,60,0.55)",  label: "50–75%" },
          { color: "rgba(49,185,120,0.45)",  label: "75–95%" },
          { color: "rgba(49,185,120,0.85)",  label: "≥ 95%" },
        ].map((item) => (
          <span key={item.label} className="coverage-legend-item">
            <span className="coverage-legend-dot" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      {/* Calendar Body */}
      {loading ? (
        <div className="empty-state" style={{ minHeight: 160 }}>加载中...</div>
      ) : viewMode === "month" ? (
        <MonthCalendar year={year} month={month} data={dailyData} />
      ) : (
        <YearCalendar year={year} data={monthlyData} />
      )}
    </div>
  );
}

// ─── Month View ────────────────────────────────────────────────────────────

function MonthCalendar({
  year, month, data
}: { year: number; month: number; data: DayCoverage[] }) {
  const coverageMap = new Map(data.map((d) => [d.day, d]));

  // Build calendar grid (Mon-Sun)
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  // getDay(): 0=Sun, 1=Mon ... adjust to Mon=0
  let startOffset = (firstDay.getDay() + 6) % 7;

  const cells: Array<{ day: number | null; dateStr: string | null }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ day: null, dateStr: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const m = String(month).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    cells.push({ day: d, dateStr: `${year}-${m}-${dd}` });
  }
  // pad to complete last row
  while (cells.length % 7 !== 0) cells.push({ day: null, dateStr: null });

  return (
    <div className="month-calendar">
      {/* Day headers */}
      <div className="month-calendar-header">
        {DAY_LABELS.map((l) => (
          <div key={l} className="month-day-label">{l}</div>
        ))}
      </div>
      {/* Day cells */}
      <div className="month-calendar-grid">
        {cells.map((cell, idx) => {
          if (!cell.dateStr || !cell.day) {
            return <div key={idx} className="day-cell empty" />;
          }
          const coverage = coverageMap.get(cell.dateStr);
          const pct = coverage?.coveragePct ?? 0;
          const dayOfWeek = (startOffset + cell.day - 1) % 7; // 0=Mon
          const isWeekend = dayOfWeek >= 5;
          const bg = coverageColor(pct, isWeekend && !coverage);
          const border = coverage ? coverageBorder(pct) : "transparent";

          return (
            <div
              key={cell.dateStr}
              className={`day-cell${isWeekend ? " weekend" : ""}`}
              style={{ background: bg, borderColor: border }}
              title={coverage
                ? `${cell.dateStr}\n${coverage.minuteCount} 分钟 · ${pct}% 覆盖率`
                : `${cell.dateStr}${isWeekend ? "（周末）" : "（无数据）"}`
              }
            >
              <span className="day-num">{cell.day}</span>
              {coverage && (
                <span className="day-pct">{pct}%</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Year View ─────────────────────────────────────────────────────────────

function YearCalendar({
  year, data
}: { year: number; data: MonthCoverage[] }) {
  const coverageMap = new Map(data.map((d) => [d.month, d]));

  return (
    <div className="year-calendar">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const key = `${year}-${String(m).padStart(2, "0")}`;
        const coverage = coverageMap.get(key);
        const pct = coverage?.coveragePct ?? 0;

        return (
          <div
            key={key}
            className="year-month-cell"
            style={{
              background: coverageColor(pct),
              borderColor: coverage ? coverageBorder(pct) : "transparent"
            }}
            title={coverage
              ? `${year}年${MONTH_NAMES[m - 1]}\n${coverage.minuteCount.toLocaleString()} 分钟 · ${pct}%`
              : `${year}年${MONTH_NAMES[m - 1]}（无数据）`
            }
          >
            <span className="year-month-name">{MONTH_NAMES[m - 1]}</span>
            {coverage && <span className="year-month-pct">{pct}%</span>}
          </div>
        );
      })}
    </div>
  );
}
