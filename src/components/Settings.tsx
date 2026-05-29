import React from "react";
import {
  Activity,
  AlertCircle,
  Calendar,
  CheckCircle,
  Clock3,
  Database,
  Download,
  FileText,
  HardDrive,
  Loader,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
  Upload
} from "lucide-react";
import { DataCoverageCalendar } from "./DataCoverageCalendar";
import type { NewsEvent } from "../types";
import { usePreferences } from "../preferences";

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

interface RuntimeSettings {
  au9999?: {
    configured: boolean;
    reachable?: boolean;
    version?: string | null;
    error?: string | null;
  };
}

interface SyncJob {
  status: "running" | "done" | "error" | "idle";
  datasetId: string;
  totalDays: number;
  completedDays: number;
  currentDay: string | null;
  error: string | null;
}

export function Settings() {
  const preferences = usePreferences();
  const [settingsData, setSettingsData] = React.useState<SettingsData | null>(null);
  const [runtimeSettings, setRuntimeSettings] = React.useState<RuntimeSettings | null>(null);
  const [events, setEvents] = React.useState<NewsEvent[]>([]);
  const [loadingDataset, setLoadingDataset] = React.useState<string | null>(null);
  const [clearingDataset, setClearingDataset] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ msg: string; ok: boolean } | null>(null);

  React.useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [dataRes, dashRes, settingsRes] = await Promise.all([
      fetch("/api/settings/data").then((r) => r.json()),
      fetch("/api/dashboard").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json())
    ]);
    setSettingsData(dataRes as SettingsData);
    setRuntimeSettings(settingsRes as RuntimeSettings);
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
      showToast(`已刷新 ${datasetId}`);
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
      showToast(`已清空 ${name}`);
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

  const totalRecords = settingsData?.datasets.reduce((sum, ds) => sum + ds.dataCount, 0) ?? 0;
  const longestHistory = Math.max(0, ...(settingsData?.datasets.map((ds) => ds.historyDays) ?? [0]));
  const configuredProviders = settingsData?.datasets.filter((ds) => {
    if (ds.id === "AU9999") return Boolean(runtimeSettings?.au9999?.reachable);
    return ds.providers.some((p) => p.configured);
  }).length ?? 0;
  const latestUpdate = latestDatasetDate(settingsData?.datasets ?? []);

  return (
    <div className="settings-page">
      {toast && (
        <div className={`settings-toast ${toast.ok ? "ok" : "error"}`}>
          {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      <header className="settings-hero">
        <div>
          <p className="settings-kicker">Data Operations</p>
          <h1>{preferences.t("dataManagement")}</h1>
          <p>管理行情历史、覆盖率、备份导入导出和舆情事件。</p>
        </div>
        <div className="settings-hero-actions">
          <button className="btn btn-ghost" onClick={handleExport}>
            <Download size={14} /> 导出
          </button>
          <label className="btn btn-ghost">
            <Upload size={14} /> 导入
            <input type="file" accept=".json" onChange={handleImport} />
          </label>
        </div>
      </header>

      <section className="settings-overview">
        <OverviewMetric icon={<Database size={17} />} label="历史记录" value={totalRecords.toLocaleString()} detail="分钟级行情与事件" />
        <OverviewMetric icon={<Clock3 size={17} />} label="最长跨度" value={`${longestHistory} 天`} detail={latestUpdate ? `最新 ${formatDateTime(latestUpdate)}` : "暂无历史数据"} />
        <OverviewMetric icon={<Server size={17} />} label="数据源" value={`${configuredProviders}/${settingsData?.datasets.length ?? 0}`} detail="已配置 provider" />
        <OverviewMetric icon={<HardDrive size={17} />} label="数据库" value={`${settingsData?.database.sizeMb ?? "--"} MB`} detail={settingsData?.database.path ?? "加载中"} />
      </section>

      <section className="settings-card">
        <SectionHeader
          icon={<Activity size={16} />}
          title={preferences.t("preferences")}
          description="主题、语言和行情涨跌色会保存在当前浏览器。"
        />
        <div className="preference-grid">
          <div className="form-row">
            <label>{preferences.t("theme")}</label>
            <select className="form-select" value={preferences.theme} onChange={(e) => preferences.setTheme(e.target.value as any)}>
              <option value="system">{preferences.t("system")}</option>
              <option value="dark">{preferences.t("dark")}</option>
              <option value="light">{preferences.t("light")}</option>
            </select>
          </div>
          <div className="form-row">
            <label>{preferences.t("language")}</label>
            <select className="form-select" value={preferences.language} onChange={(e) => preferences.setLanguage(e.target.value as any)}>
              <option value="system">{preferences.t("system")}</option>
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
          <div className="form-row">
            <label>{preferences.t("marketColors")}</label>
            <select className="form-select" value={preferences.marketColors} onChange={(e) => preferences.setMarketColors(e.target.value as any)}>
              <option value="red-up">{preferences.t("redUp")}</option>
              <option value="green-up">{preferences.t("greenUp")}</option>
            </select>
          </div>
        </div>
      </section>

      <div className="settings-workspace">
        <section className="settings-card settings-card-primary">
          <SectionHeader
            icon={<Calendar size={16} />}
            title="历史同步"
            description="按日期范围补齐 OANDA 分钟级历史行情。"
          />
          <DateRangeSyncForm onDone={loadAll} showToast={showToast} />
        </section>

        <section className="settings-card">
          <SectionHeader
            icon={<Activity size={16} />}
            title="覆盖日历"
            description="检查各品种历史数据是否连续。"
          />
          <DataCoverageCalendar />
        </section>
      </div>

      <section className="settings-card">
        <SectionHeader
          icon={<Database size={16} />}
          title="数据集"
          description="查看各数据集状态，执行即时刷新或清空。"
        />
        <div className="dataset-grid">
          {(settingsData?.datasets ?? []).map((ds) => (
            <DatasetCard
              key={ds.id}
              ds={ds}
              aktools={ds.id === "AU9999" ? runtimeSettings?.au9999 : undefined}
              loading={loadingDataset === ds.id}
              clearing={clearingDataset === ds.id}
              onFetch={() => handleFetch(ds.id)}
              onClear={() => handleClear(ds.id, ds.name)}
            />
          ))}
        </div>
      </section>

      <div className="settings-workspace events-workspace">
        <section className="settings-card">
          <SectionHeader
            icon={<Plus size={16} />}
            title="事件补录"
            description="手动写入会影响图表舆情评分的事件。"
          />
          <EventSupplementForm onDone={loadAll} showToast={showToast} />
        </section>

        <section className="settings-card">
          <SectionHeader
            icon={<FileText size={16} />}
            title="事件日志"
            description={`当前展示最新 ${Math.min(events.length, 30)} 条。`}
          />
          <EventLogManager events={events} onDelete={handleDeleteEvent} />
        </section>
      </div>

      <section className="danger-zone">
        <div className="danger-zone-info">
          <ShieldAlert size={18} />
          <div>
            <h4>清空所有数据</h4>
            <p>删除全部历史行情、实时报价与舆情事件。操作后需要重新初始化。</p>
          </div>
        </div>
        <button
          className="btn btn-danger"
          disabled={!!clearingDataset}
          onClick={() => handleClear("all", "所有数据")}
        >
          <Trash2 size={14} /> 清空所有
        </button>
      </section>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  description
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="settings-section-header">
      <span className="settings-section-icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function OverviewMetric({
  icon,
  label,
  value,
  detail
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="overview-metric">
      <span className="overview-metric-icon">{icon}</span>
      <div>
        <span className="overview-metric-label">{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function DatasetCard({
  ds,
  aktools,
  loading,
  clearing,
  onFetch,
  onClear
}: {
  ds: DatasetStat;
  aktools?: RuntimeSettings["au9999"];
  loading: boolean;
  clearing: boolean;
  onFetch: () => void;
  onClear: () => void;
}) {
  const configured = ds.id === "AU9999" && aktools ? Boolean(aktools.reachable) : ds.providers.some((p) => p.configured);
  const coverageState = ds.dataCount === 0 ? "empty" : ds.historyDays >= 30 ? "good" : "partial";

  return (
    <div className={`dataset-card ${coverageState}`}>
      <div className="dataset-card-header">
        <div>
          <h4 className="dataset-card-name">{ds.name}</h4>
          <span className="dataset-provider">{ds.activeProvider}</span>
        </div>
        <span className={`dataset-status ${configured ? "ok" : "warn"}`}>
          {configured ? "可用" : ds.id === "AU9999" && aktools?.configured ? "不可用" : "未配置"}
        </span>
      </div>

      <div className="dataset-card-stats">
        <DatasetStatRow label="记录" value={`${ds.dataCount.toLocaleString()} 条`} />
        <DatasetStatRow label="跨度" value={ds.historyDays > 0 ? `${ds.historyDays} 天` : "暂无"} />
        <DatasetStatRow label="最新" value={ds.latestData ? formatDateTime(ds.latestData) : "暂无"} />
        {ds.id === "AU9999" && aktools?.configured && (
          <DatasetStatRow label="接口" value={aktools.reachable ? (aktools.version ?? "version ok") : (aktools.error ?? "不可用")} />
        )}
      </div>

      <div className="dataset-progress" aria-hidden="true">
        <span style={{ width: `${Math.min(100, ds.historyDays)}%` }} />
      </div>

      <div className="dataset-card-actions">
        <button className="btn btn-ghost btn-sm" disabled={loading || clearing} onClick={onFetch}>
          {loading ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />} 刷新
        </button>
        <button className="btn btn-danger btn-sm" disabled={loading || clearing} onClick={onClear}>
          {clearing ? <Loader size={12} className="spin" /> : <Trash2 size={12} />} 清空
        </button>
      </div>
    </div>
  );
}

function DatasetStatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="dataset-stat-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DateRangeSyncForm({
  onDone,
  showToast
}: {
  onDone: () => void;
  showToast: (msg: string, ok?: boolean) => void;
}) {
  const today = toDateStr(new Date());
  const default30 = toDateStr(new Date(Date.now() - 30 * 86_400_000));

  const [datasetId, setDatasetId] = React.useState<"all" | "XAU_USD" | "USD_CNH">("all");
  const [startDate, setStartDate] = React.useState(default30);
  const [endDate, setEndDate] = React.useState(today);
  const [syncJob, setSyncJob] = React.useState<SyncJob | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    loadExistingJob();
    return () => { stopPolling(); };
  }, []);

  async function loadExistingJob() {
    try {
      const res = await fetch("/api/settings/data/sync-status");
      if (!res.ok) return;
      const job: SyncJob = await res.json();
      if (job.status === "running") {
        setSyncJob(job);
        setSubmitting(true);
        startPolling();
      }
    } catch {
      // Status is advisory; the form can still submit if this check fails.
    }
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const r = await fetch("/api/settings/data/sync-status");
      const job: SyncJob = await r.json();
      setSyncJob(job);
      if (job.status === "done") {
        stopPolling();
        setSubmitting(false);
        showToast(`同步完成：共 ${job.completedDays} 天`);
        onDone();
      } else if (job.status === "error") {
        stopPolling();
        setSubmitting(false);
        showToast(job.error ?? "同步出错", false);
      }
    }, 800);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

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
      startPolling();
    } catch (err) {
      setSubmitting(false);
      showToast(err instanceof Error ? err.message : "同步失败", false);
    }
  }

  const progressPct = syncJob && syncJob.totalDays > 0
    ? Math.round((syncJob.completedDays / syncJob.totalDays) * 100)
    : 0;

  return (
    <form className="sync-form" onSubmit={handleStart}>
      <div className="sync-grid">
        <div className="form-row">
          <label>数据集</label>
          <select
            className="form-select"
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value as any)}
            disabled={submitting}
          >
            <option value="all">XAU/USD + USD/CNH</option>
            <option value="XAU_USD">仅 XAU/USD</option>
            <option value="USD_CNH">仅 USD/CNH</option>
          </select>
        </div>
        <div className="form-row">
          <label>开始</label>
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
          <label>结束</label>
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

      <div className="preset-row">
        {[
          { label: "30 天", days: 30 },
          { label: "90 天", days: 90 },
          { label: "180 天", days: 180 },
          { label: "365 天", days: 365 }
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

      {syncJob && (
        <div className="sync-progress">
          <div>
            <span>{syncJob.status === "done" ? "同步完成" : syncJob.currentDay ? `正在同步 ${syncJob.currentDay}` : "准备中"}</span>
            <strong>{syncJob.completedDays} / {syncJob.totalDays} 天</strong>
          </div>
          <div className="sync-progress-track">
            <span style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      <div className="sync-footer">
        <p>AU9999 暂不支持历史区间同步，仅保留实时行情。</p>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? <><Loader size={14} className="spin" /> 同步中</> : <><Calendar size={14} /> 开始同步</>}
        </button>
      </div>
    </form>
  );
}

function EventSupplementForm({
  onDone,
  showToast
}: {
  onDone: () => void;
  showToast: (msg: string, ok?: boolean) => void;
}) {
  const [time, setTime] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [source, setSource] = React.useState("手动补录");
  const [category, setCategory] = React.useState("黄金市场");
  const [direction, setDirection] = React.useState("bullish");
  const [impact, setImpact] = React.useState("30");
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
          title,
          source,
          category,
          direction,
          impact: parseFloat(impact)
        })
      });
      if (!res.ok) throw new Error();
      showToast("事件已写入");
      setTime("");
      setTitle("");
      onDone();
    } catch {
      showToast("补录失败", false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="event-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>事件时间</label>
        <input type="datetime-local" className="form-input" value={time} onChange={(e) => setTime(e.target.value)} required />
      </div>
      <div className="form-row">
        <label>标题</label>
        <input type="text" className="form-input" placeholder="例如：美联储宣布加息25bp" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="form-row">
        <label>来源</label>
        <input type="text" className="form-input" placeholder="Reuters / 手动补录" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>
      <div className="event-form-grid">
        <div className="form-row">
          <label>分类</label>
          <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {["黄金市场", "美联储", "美元", "美债", "通胀", "地缘政治"].map((c) => <option key={c}>{c}</option>)}
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
          <input type="number" min="-100" max="100" className="form-input" value={impact} onChange={(e) => setImpact(e.target.value)} />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? <Loader size={14} className="spin" /> : <Plus size={14} />} 写入事件
      </button>
    </form>
  );
}

function EventLogManager({
  events,
  onDelete
}: {
  events: NewsEvent[];
  onDelete: (id: string) => void;
}) {
  if (!events.length) {
    return <div className="empty-state compact">暂无舆情事件数据。</div>;
  }

  return (
    <div className="event-log-shell">
      <table className="event-log-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>来源</th>
            <th>标题</th>
            <th>分类</th>
            <th>方向</th>
            <th>评分</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events.slice(0, 30).map((ev) => (
            <tr key={ev.id}>
              <td>{formatDateTime(ev.time)}</td>
              <td>{ev.source}</td>
              <td className="event-title-cell">
                {ev.url
                  ? <a href={ev.url} target="_blank" rel="noreferrer">{ev.title}</a>
                  : ev.title}
              </td>
              <td>{ev.category}</td>
              <td>
                <span className={`event-direction-badge ${ev.direction}`}>
                  {ev.direction === "bullish" ? "利多" : ev.direction === "bearish" ? "利空" : "中性"}
                </span>
              </td>
              <td className={ev.impact > 0 ? "event-impact-positive" : ev.impact < 0 ? "event-impact-negative" : "event-impact-neutral"}>
                {ev.impact > 0 ? `+${ev.impact}` : ev.impact}
              </td>
              <td>
                <button className="icon-danger-btn" onClick={() => onDelete(ev.id)} title="删除" aria-label="删除事件">
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length > 30 && <p className="event-log-note">仅展示最新 30 条，共 {events.length} 条事件</p>}
    </div>
  );
}

function latestDatasetDate(datasets: DatasetStat[]) {
  const dates = datasets
    .map((ds) => ds.latestData)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return dates[0] ?? null;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
