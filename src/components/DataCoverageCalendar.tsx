import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

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

// ─── Coverage Color ────────────────────────────────────────────────────────

function coverageTone(pct: number, isWeekend = false): string {
  if (isWeekend) return "bg-muted/60 border-transparent";
  if (pct === 0) return "bg-muted/40 border-transparent";
  if (pct < 50) return "bg-destructive/40 border-destructive/30 border";
  if (pct < 75) return "bg-warning/45 border-warning/30 border";
  if (pct < 95) return "bg-success/35 border-success/25 border";
  return "bg-success/75 border-success/35 border";
}

// ─── Component ─────────────────────────────────────────────────────────────

export function DataCoverageCalendar() {
  const { t } = useTranslation();
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
    ? t("monthFormat", { year, month: t(`month_${month}`) })
    : t("yearFormat", { year });

  return (
    <div className="bg-card border border-border rounded-lg p-3 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="h-9 border border-input rounded-md px-3 text-xs w-[118px] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYMBOLS.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex overflow-hidden border border-border rounded-md bg-background">
            <Button
              variant={viewMode === "month" ? "secondary" : "ghost"}
              size="sm"
              className={cn("h-8 px-2.5 text-xs rounded-none border-0 shadow-none", viewMode === "month" && "bg-accent text-accent-foreground")}
              onClick={() => setViewMode("month")}
            >{t("viewModeMonth")}</Button>
            <Button
              variant={viewMode === "year" ? "secondary" : "ghost"}
              size="sm"
              className={cn("h-8 px-2.5 text-xs rounded-none border-0 shadow-none", viewMode === "year" && "bg-accent text-accent-foreground")}
              onClick={() => setViewMode("year")}
            >{t("viewModeYear")}</Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="compactIcon" className="h-8 w-8" onClick={prevPeriod}>
            <ChevronLeft size={14} />
          </Button>
          <span className="min-w-[112px] text-foreground text-xs font-extrabold text-center">{title}</span>
          <Button variant="outline" size="compactIcon" className="h-8 w-8" onClick={nextPeriod}>
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {[
          { tone: "bg-muted/40 border-transparent", label: t("noDataEmpty") },
          { tone: "bg-destructive/40 border-destructive/30 border", label: "< 50%" },
          { tone: "bg-warning/45 border-warning/30 border", label: "50–75%" },
          { tone: "bg-success/35 border-success/25 border", label: "75–95%" },
          { tone: "bg-success/75 border-success/35 border", label: "≥ 95%" },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
            <span className={cn("w-2.5 h-2.5 rounded-[2px]", item.tone)} />
            {item.label}
          </span>
        ))}
      </div>

      {/* Calendar Body */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[160px] text-muted-foreground text-xs">{t("loading")}</div>
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
  const { t } = useTranslation();
  const coverageMap = new Map(data.map((d) => [d.day, d]));

  const dayLabels = React.useMemo(() => Array.from({ length: 7 }, (_, i) => t(`day_${i + 1}`)), [t]);

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
    <div className="flex flex-col gap-1">
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0.75">
        {dayLabels.map((l) => (
          <div key={l} className="py-1 text-muted-foreground text-[11px] font-bold text-center">{l}</div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.75">
        {cells.map((cell, idx) => {
          if (!cell.dateStr || !cell.day) {
            return <div key={idx} className="aspect-square min-h-[34px] bg-transparent border border-transparent" />;
          }
          const coverage = coverageMap.get(cell.dateStr);
          const pct = coverage?.coveragePct ?? 0;
          const dayOfWeek = (startOffset + cell.day - 1) % 7; // 0=Mon
          const isWeekend = dayOfWeek >= 5;
          const tone = coverageTone(pct, isWeekend && !coverage);

          return (
            <div
              key={cell.dateStr}
              className={cn("aspect-square min-h-[34px] flex flex-col items-center justify-center gap-0.5 border border-transparent rounded-[5px] transition-colors", tone)}
              title={coverage
                ? `${cell.dateStr}\n${coverage.minuteCount} 分钟 · ${pct}% 覆盖率`
                : `${cell.dateStr}${isWeekend ? ` (${t("noDataWeekend")})` : ` (${t("noDataEmpty")})`}`
              }
            >
              <span className={cn("text-xs font-bold leading-none", (isWeekend && !coverage) ? "text-muted-foreground" : "text-foreground")}>{cell.day}</span>
              {coverage && (
                <span className="text-[9px] opacity-80 leading-none">{pct}%</span>
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
  const { t } = useTranslation();
  const coverageMap = new Map(data.map((d) => [d.month, d]));

  return (
    <div className="grid grid-cols-4 gap-2">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const key = `${year}-${String(m).padStart(2, "0")}`;
        const coverage = coverageMap.get(key);
        const pct = coverage?.coveragePct ?? 0;
        const monthLabel = t(`month_${m}`);

        return (
          <div
            key={key}
            className={cn("min-h-[76px] flex flex-col items-center justify-center gap-1 border border-transparent rounded-md p-2.5 transition-colors", coverageTone(pct))}
            title={coverage
              ? `${year}年${monthLabel}\n${coverage.minuteCount.toLocaleString()} 分钟 · ${pct}%`
              : `${year}年${monthLabel} (${t("noDataEmpty")})`
            }
          >
            <span className="text-foreground text-sm font-extrabold">{monthLabel}</span>
            {coverage && <span className="text-foreground/75 text-[11px] font-bold">{pct}%</span>}
          </div>
        );
      })}
    </div>
  );
}
