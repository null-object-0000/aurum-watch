import React from "react";
import {
  RefreshCw, Trash2, Download, Upload,
  Plus, Database, Loader, CheckCircle, AlertCircle, Calendar
} from "lucide-react";
import { DataCoverageCalendar } from "./DataCoverageCalendar";
import type { NewsEvent } from "../types";

// ─── Types ─────────────────────────────────────────────────────────────────

interface DatasetStat {
  id: string;
  name: string;
  activeProvider: string;
  providers: Array<{ name: string; configured: boolean }>;
  dataCount: number;
  earliestData: string | null;
  latestData: string | null;
  historyDays: number;
}

interface SettingsData {
  database: { path: string; sizeBytes: number; sizeMb: string };
  datasets: DatasetStat[];
}

interface SyncJob {
  status: "running" | "done" | "error" | "idle";
  datasetId: string;
  totalDays: number;
  completedDays: number;
  currentDay: string | null;
  error: string | null;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function Settings() {
  const [settingsData, setSettingsData] = React.useState<SettingsData | null>(null);
  const [events, setEvents] = React.useState<NewsEvent[]>([]);
  const [loadingDataset, setLoadingDataset] = React.useState<string | null>(null);
  const [clearingDataset, setClearingDataset] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ msg: string; ok: boolean } | null>(null);

  React.useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [dataRes, dashRes] = await Promise.all([
      fetch("/api/settings/data").then((r) => r.json()),
      fetch("/api/dashboard").then((r) => r.json())
    ]);
    setSettingsData(dataRes as SettingsData);
    setEvents((dashRes as any).events ?? []);
  }

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleFetch(datasetId: string) {
    setLoadingDataset(datasetId);
    try {
      const res = await fetch("/api/settings/data/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId })
      });
      if (!res.ok) throw new Error();
      showToast(`已成功刷新：${datasetId}`);
      await loadAll();
    } catch {
      showToast(`刷新失败：${datasetId}`, false);
    } finally {
      setLoadingDataset(null);
    }
  }

  async function handleClear(datasetId: string, name: string) {
    if (!window.confirm(`确认清空「${name}」的所有历史数据？此操作不可撤销。`)) return;
    setClearingDataset(datasetId);
    try {
      const res = await fetch("/api/settings/data/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId })
      });
      if (!res.ok) throw new Error();
      showToast(`已清空：${name}`);
      await loadAll();
    } catch {
      showToast(`清空失败：${name}`, false);
    } finally {
      setClearingDataset(null);
    }
  }

  async function handleDeleteEvent(id: string) {
    if (!window.confirm("确认删除该舆情事件？")) return;
    const res = await fetch(`/api/settings/data/events/${id}`, { method: "DELETE" });
    if (res.ok) {
      showToast("已删除舆情事件");
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } else {
      showToast("删除失败", false);
    }
  }

  async function handleExport() {
    const res = await fetch("/api/settings/data/export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aurum-watch-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("已导出数据备份");
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const res = await fetch("/api/settings/data/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error();
      showToast("导入成功");
      await loadAll();
    } catch {
      showToast("导入失败，请检查文件格式", false);
    }
    e.target.value = "";
  }

  return (
    <div className="settings-page">
      {/* Toast */}
      {toast && (
        <div className={`settings-toast ${toast.ok ? "ok" : "error"}`}>
          {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      {/* 1. Data Coverage Calendar */}
      <section className="settings-section">
        <h3 className="settings-section-title">数据覆盖日历</h3>
        <DataCoverageCalendar />
      </section>

      {/* 2. Date Range Sync */}
      <section className="settings-section">
        <h3 className="settings-section-title">历史数据同步</h3>
        <DateRangeSyncForm onDone={loadAll} showToast={showToast} />
      </section>

      {/* 3. DB Stats */}
      <section className="settings-section">
        <h3 className="settings-section-title">数据库状态</h3>
        {settingsData ? (
          <div className="db-stats-card">
            <div className="db-stat-item" style={{ flex: 1 }}>
              <span className="db-stat-label">存储路径</span>
              <span className="db-stat-value" style={{ fontSize: 12, wordBreak: "break-all" }}>
                {settingsData.database.path}
              </span>
            </div>
            <div className="db-stat-item">
              <span className="db-stat-label">文件大小</span>
              <span className="db-stat-value">{settingsData.database.sizeMb} MB</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignSelf: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={handleExport}>
                <Download size={13} /> 导出备份
              </button>
              <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
                <Upload size={13} /> 导入备份
                <input type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
              </label>
            </div>
          </div>
        ) : (
          <div className="empty-state"><Loader size={18} className="spin" /></div>
        )}
      </section>

      {/* 4. Dataset Cards */}
      <section className="settings-section">
        <h3 className="settings-section-title">数据集状态</h3>
        <div className="dataset-grid">
          {(settingsData?.datasets ?? []).map((ds) => (
            <DatasetCard
              key={ds.id}
              ds={ds}
              loading={loadingDataset === ds.id}
              clearing={clearingDataset === ds.id}
              onFetch={() => handleFetch(ds.id)}
              onClear={() => handleClear(ds.id, ds.name)}
            />
          ))}
        </div>
      </section>

      {/* 5. Event Supplement */}
      <section className="settings-section">
        <h3 className="settings-section-title">舆情事件补录</h3>
        <div style={{ maxWidth: 520 }}>
          <EventSupplementForm onDone={loadAll} showToast={showToast} />
        </div>
      </section>

      {/* 6. Event Log */}
      <section className="settings-section">
        <h3 className="settings-section-title">舆情事件日志</h3>
        <EventLogManager events={events} onDelete={handleDeleteEvent} />
      </section>

      {/* 7. Danger Zone */}
      <section className="settings-section">
        <h3 className="settings-section-title">危险操作</h3>
        <div className="danger-zone">
          <div className="danger-zone-info">
            <h4>清空所有数据</h4>
            <p>清空所有历史行情、实时报价与舆情事件，仪表盘将恢复至初始状态，需重新初始化。</p>
          </div>
          <button
            className="btn btn-danger"
            disabled={!!clearingDataset}
            onClick={() => handleClear("all", "所有数据")}
          >
            <Trash2 size={14} /> 清空所有数据
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Dataset Card ──────────────────────────────────────────────────────────

function DatasetCard({
  ds, loading, clearing, onFetch, onClear
}: {
  ds: DatasetStat;
  loading: boolean;
  clearing: boolean;
  onFetch: () => void;
  onClear: () => void;
}) {
  return (
    <div className="dataset-card">
      <div className="dataset-card-header">
        <h4 className="dataset-card-name">{ds.name}</h4>
        <span className="dataset-provider-badge">{ds.activeProvider}</span>
      </div>
      <div className="dataset-card-stats">
        <div className="dataset-stat-row">
          <span>历史记录</span>
          <strong>{ds.dataCount.toLocaleString()} 条</strong>
        </div>
        <div className="dataset-stat-row">
          <span>历史跨度</span>
          <strong>{ds.historyDays > 0 ? `${ds.historyDays} 天` : "暂无数据"}</strong>
        </div>
        {ds.latestData && (
          <div className="dataset-stat-row">
            <span>最新数据</span>
            <strong style={{ fontSize: 11 }}>
              {new Date(ds.latestData).toLocaleString("zh-CN", { hour12: false })}
            </strong>
          </div>
        )}
      </div>
      <div className="dataset-card-actions">
        <button className="btn btn-primary btn-sm" disabled={loading || clearing} onClick={onFetch}>
          {loading ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />} 刷新
        </button>
        <button className="btn btn-danger btn-sm" disabled={loading || clearing} onClick={onClear}>
          {clearing ? <Loader size={12} className="spin" /> : <Trash2 size={12} />} 清空
        </button>
      </div>
    </div>
  );
}

// ─── Date Range Sync Form ──────────────────────────────────────────────────

function DateRangeSyncForm({
  onDone, showToast
}: { onDone: () => void; showToast: (msg: string, ok?: boolean) => void }) {
  const today = toDateStr(new Date());
  const default90 = toDateStr(new Date(Date.now() - 90 * 86_400_000));

  const [datasetId, setDatasetId] = React.useState<"all" | "XAU_USD" | "USD_CNH">("all");
  const [startDate, setStartDate] = React.useState(default90);
  const [endDate, setEndDate] = React.useState(today);
  const [syncJob, setSyncJob] = React.useState<SyncJob | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate) return;
    setSubmitting(true);
    setSyncJob(null);

    try {
      const res = await fetch("/api/settings/data/sync-range", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, startDate, endDate })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "请求失败" }));
        throw new Error((err as any).error ?? "启动失败");
      }
      const data = await res.json();
      // Start polling
      pollRef.current = setInterval(async () => {
        const r = await fetch("/api/settings/data/sync-status");
        const job: SyncJob = await r.json();
        setSyncJob(job);
        if (job.status === "done") {
          clearInterval(pollRef.current!);
          setSubmitting(false);
          showToast(`同步完成：共 ${job.completedDays} 天数据已写入`);
          onDone();
        } else if (job.status === "error") {
          clearInterval(pollRef.current!);
          setSubmitting(false);
          showToast(job.error ?? "同步出错", false);
        }
      }, 800);
    } catch (err) {
      setSubmitting(false);
      showToast(err instanceof Error ? err.message : "同步失败", false);
    }
  }

  const progressPct = syncJob && syncJob.totalDays > 0
    ? Math.round((syncJob.completedDays / syncJob.totalDays) * 100)
    : 0;

  const isDone = syncJob?.status === "done";

  return (
    <form className="supplement-card" onSubmit={handleStart}>
      <h4 className="supplement-card-title">
        <Calendar size={15} /> 按日期范围同步历史行情
      </h4>

      <div className="form-row">
        <label>数据集</label>
        <select
          className="form-select"
          value={datasetId}
          onChange={(e) => setDatasetId(e.target.value as any)}
          disabled={submitting}
        >
          <option value="all">全部（XAU/USD + USD/CNH）</option>
          <option value="XAU_USD">仅 XAU/USD</option>
          <option value="USD_CNH">仅 USD/CNH</option>
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="form-row">
          <label>开始日期</label>
          <input
            type="date"
            className="form-input"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={submitting}
            required
          />
        </div>
        <div className="form-row">
          <label>结束日期</label>
          <input
            type="date"
            className="form-input"
            value={endDate}
            min={startDate}
            max={today}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={submitting}
            required
          />
        </div>
      </div>

      {/* Quick presets */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { label: "近 30 天", days: 30 },
          { label: "近 90 天", days: 90 },
          { label: "近 180 天", days: 180 },
          { label: "近 365 天", days: 365 },
        ].map((p) => (
          <button
            key={p.days}
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={submitting}
            onClick={() => {
              setEndDate(today);
              setStartDate(toDateStr(new Date(Date.now() - p.days * 86_400_000)));
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Progress */}
      {syncJob && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#7e8998" }}>
            <span>
              {isDone ? "同步完成 ✓" : syncJob.currentDay ? `${syncJob.currentDay}` : "准备中..."}
            </span>
            <span>{syncJob.completedDays} / {syncJob.totalDays} 天</span>
          </div>
          <div style={{ height: 5, background: "#1a2330", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${progressPct}%`,
              background: isDone ? "#31b978" : "linear-gradient(90deg,#1f5799,#2468b3)",
              borderRadius: 4,
              transition: "width 0.3s ease"
            }} />
          </div>
        </div>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? <><Loader size={14} className="spin" /> 正在逐天同步...</> : <><Calendar size={14} /> 开始同步</>}
      </button>

      <p className="text-muted" style={{ margin: 0, fontSize: 11 }}>
        * AU9999（国内金价）暂不支持历史区间同步，仅拉当前实时价格。
      </p>
    </form>
  );
}

// ─── Event Supplement Form ─────────────────────────────────────────────────

function EventSupplementForm({
  onDone, showToast
}: { onDone: () => void; showToast: (msg: string, ok?: boolean) => void }) {
  const [time, setTime]           = React.useState("");
  const [title, setTitle]         = React.useState("");
  const [source, setSource]       = React.useState("手动补录");
  const [category, setCategory]   = React.useState("黄金市场");
  const [direction, setDirection] = React.useState("bullish");
  const [impact, setImpact]       = React.useState("30");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!time || !title) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/data/supplement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "event",
          time: new Date(time).toISOString(),
          title, source, category, direction,
          impact: parseFloat(impact)
        })
      });
      if (!res.ok) throw new Error();
      showToast("事件补录成功，舆情评分已更新");
      setTime(""); setTitle("");
      onDone();
    } catch {
      showToast("补录失败", false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="supplement-card" onSubmit={handleSubmit}>
      <h4 className="supplement-card-title">
        <Database size={15} /> 手动补录舆情事件
      </h4>
      <div className="form-row">
        <label>事件时间</label>
        <input type="datetime-local" className="form-input" value={time}
          onChange={(e) => setTime(e.target.value)} required />
      </div>
      <div className="form-row">
        <label>事件标题</label>
        <input type="text" className="form-input" placeholder="例如：美联储宣布加息25bp"
          value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="form-row">
        <label>来源</label>
        <input type="text" className="form-input" placeholder="例如：Reuters"
          value={source} onChange={(e) => setSource(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div className="form-row">
          <label>分类</label>
          <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {["黄金市场","美联储","美元","美债","通胀","地缘政治"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>方向</label>
          <select className="form-select" value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="bullish">利多</option>
            <option value="bearish">利空</option>
            <option value="neutral">中性</option>
          </select>
        </div>
        <div className="form-row">
          <label>评分</label>
          <input type="number" min="-100" max="100" className="form-input"
            value={impact} onChange={(e) => setImpact(e.target.value)} />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? <Loader size={14} className="spin" /> : <Plus size={14} />} 写入事件
      </button>
    </form>
  );
}

// ─── Event Log Manager ─────────────────────────────────────────────────────

function EventLogManager({
  events, onDelete
}: { events: NewsEvent[]; onDelete: (id: string) => void }) {
  if (!events.length) {
    return <div className="empty-state">暂无舆情事件数据。</div>;
  }
  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="event-log-table">
          <thead>
            <tr>
              <th>时间</th><th>来源</th><th>标题</th><th>分类</th><th>方向</th><th>评分</th><th></th>
            </tr>
          </thead>
          <tbody>
            {events.slice(0, 30).map((ev) => (
              <tr key={ev.id}>
                <td style={{ whiteSpace: "nowrap", fontSize: 11 }}>
                  {new Date(ev.time).toLocaleString("zh-CN", { hour12: false })}
                </td>
                <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{ev.source}</td>
                <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ev.url
                    ? <a href={ev.url} target="_blank" rel="noreferrer" style={{ color: "#8db3e2" }}>{ev.title}</a>
                    : ev.title}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{ev.category}</td>
                <td>
                  <span className={`event-direction-badge ${ev.direction}`}>
                    {ev.direction === "bullish" ? "利多" : ev.direction === "bearish" ? "利空" : "中性"}
                  </span>
                </td>
                <td className={ev.impact > 0 ? "event-impact-positive" : ev.impact < 0 ? "event-impact-negative" : "event-impact-neutral"}>
                  {ev.impact > 0 ? `+${ev.impact}` : ev.impact}
                </td>
                <td>
                  <button className="btn btn-danger btn-sm" onClick={() => onDelete(ev.id)} title="删除">
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length > 30 && (
          <p className="text-muted" style={{ textAlign: "center", padding: "10px 0" }}>
            仅展示最新 30 条，共 {events.length} 条事件
          </p>
        )}
      </div>
    </div>
  );
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
