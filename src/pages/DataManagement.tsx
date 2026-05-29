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
  Upload,
  Wifi
} from "lucide-react";
import { DataCoverageCalendar } from "../components/DataCoverageCalendar";
import type { NewsEvent } from "../types";
import { usePreferences } from "../preferences";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SYNC_STATUS_POLL_MS = 1000;

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
  oanda?: {
    configured: boolean;
    env: string;
  };
  au9999?: {
    configured: boolean;
    reachable?: boolean;
    version?: string | null;
    error?: string | null;
  };
  news?: {
    provider: string;
    query: string;
  };
  storage?: {
    databasePath: string;
  };
}

interface SyncJob {
  status: "running" | "done" | "error" | "idle";
  datasetId?: string;
  startDate?: string;
  endDate?: string;
  totalDays?: number;
  completedDays?: number;
  currentDay: string | null;
  error: string | null;
  startedAt?: string;
}

export function DataManagement() {
  const { t } = useTranslation();
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
      showToast(`${t("refresh")} ${datasetId}`);
      await loadAll();
    } catch {
      showToast(`${t("refresh")} ${t("status_error")}：${datasetId}`, false);
    } finally {
      setLoadingDataset(null);
    }
  }

  async function handleClear(datasetId: string, name: string) {
    if (!window.confirm(preferences.language === "en-US" 
      ? `Are you sure you want to clear all history for "${name}"? This cannot be undone.`
      : `确认清空「${name}」的所有历史数据？此操作不可撤销。`)) return;
    setClearingDataset(datasetId);
    try {
      const res = await fetch("/api/settings/data/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId })
      });
      if (!res.ok) throw new Error();
      showToast(`${t("clear")} ${name}`);
      await loadAll();
    } catch {
      showToast(`${t("clear")} ${t("status_error")}：${name}`, false);
    } finally {
      setClearingDataset(null);
    }
  }

  async function handleDeleteEvent(id: string) {
    if (!window.confirm(preferences.language === "en-US" ? "Are you sure you want to delete this event?" : "确认删除该舆情事件？")) return;
    const res = await fetch(`/api/settings/data/events/${id}`, { method: "DELETE" });
    if (res.ok) {
      showToast(preferences.language === "en-US" ? "Event deleted" : "已删除舆情事件");
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } else {
      showToast(preferences.language === "en-US" ? "Delete failed" : "删除失败", false);
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
    showToast(preferences.language === "en-US" ? "Backup exported" : "已导出数据备份");
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
      showToast(preferences.language === "en-US" ? "Imported successfully" : "导入成功");
      await loadAll();
    } catch {
      showToast(preferences.language === "en-US" ? "Import failed, please check file format" : "导入失败，请检查文件格式", false);
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
    <div className="w-full max-w-7xl mx-auto py-2.5 pb-7 flex flex-col gap-3.5 px-4 md:px-0">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-sm font-semibold transition-all ${
          toast.ok 
            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" 
            : "bg-destructive/10 text-destructive border-destructive/20"
        }`}>
          {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      <header className="flex items-end justify-between gap-4.5 pt-1.5 pb-0.5 px-0.5 flex-wrap">
        <div>
          <p className="m-0 mb-1 text-[11px] font-bold tracking-[0.11em] uppercase text-slate-500">Data Operations</p>
          <h1 className="m-0 text-2xl font-bold leading-tight text-foreground">{t("dataManagementTitle")}</h1>
          <p className="m-0 mt-1.5 text-xs text-muted-foreground">{t("dataManagementDesc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-9 text-xs" onClick={handleExport}>
            <Download size={14} /> {t("export")}
          </Button>
          <Button variant="outline" className="h-9 text-xs" asChild>
            <label className="cursor-pointer">
              <Upload size={14} /> {t("import")}
              <input type="file" accept=".json" onChange={handleImport} className="sr-only" />
            </label>
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <OverviewMetric icon={<Database size={17} />} label={t("historyRecords")} value={totalRecords.toLocaleString()} detail={t("historyDetail")} />
        <OverviewMetric icon={<Clock3 size={17} />} label={t("maxSpan")} value={`${longestHistory} ${preferences.language === "en-US" ? "Days" : "天"}`} detail={latestUpdate ? `${t("latest")} ${formatDateTime(latestUpdate)}` : t("noHistory")} />
        <OverviewMetric icon={<Server size={17} />} label={t("dataSources")} value={`${configuredProviders}/${settingsData?.datasets.length ?? 0}`} detail={t("configuredProviders")} />
        <OverviewMetric icon={<HardDrive size={17} />} label={t("database")} value={`${settingsData?.database.sizeMb ?? "--"} MB`} detail={settingsData?.database.path ?? t("loading")} />
      </section>

      <section className="min-w-0 bg-card border border-border rounded-lg p-3.5 flex flex-col gap-3.5">
        <SectionHeader
          icon={<Database size={16} />}
          title={t("datasets")}
          description={t("datasetsDesc")}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
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

      <section className="min-w-0 bg-card border border-border rounded-lg p-3.5 flex flex-col gap-3.5">
        <SectionHeader
          icon={<Calendar size={16} />}
          title={t("dataHistoryMaintenance")}
          description={t("dataHistoryDesc")}
        />
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,_0.42fr)_1fr] gap-3.5 items-start">
          <div className="min-w-0 min-h-full p-3.5 bg-background border border-border rounded-lg">
            <div className="h-full flex flex-col gap-3">
              <DateRangeSyncForm onDone={loadAll} showToast={showToast} />
            </div>
          </div>
          <DataCoverageCalendar />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(360px,_0.72fr)_minmax(580px,_1.28fr)] gap-3.5 items-start">
        <section className="min-w-0 bg-card border border-border rounded-lg p-3.5 flex flex-col gap-3.5">
          <SectionHeader
            icon={<Plus size={16} />}
            title={t("eventSupplement")}
            description={t("eventSupplementDesc")}
          />
          <EventSupplementForm onDone={loadAll} showToast={showToast} />
        </section>

        <section className="min-w-0 bg-card border border-border rounded-lg p-3.5 flex flex-col gap-3.5">
          <SectionHeader
            icon={<FileText size={16} />}
            title={t("eventLog")}
            description={t("eventLogDesc", { count: Math.min(events.length, 30) })}
          />
          <EventLogManager events={events} onDelete={handleDeleteEvent} />
        </section>
      </div>

      <section className="border border-destructive/30 rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-destructive/5 mt-2">
        <div className="flex items-start gap-3 text-destructive">
          <ShieldAlert size={18} className="mt-0.5" />
          <div>
            <h4 className="m-0 text-foreground text-sm font-bold">{t("clearAllData")}</h4>
            <p className="m-0 mt-0.5 text-muted-foreground text-xs">{t("clearAllDataDesc")}</p>
          </div>
        </div>
        <Button
          variant="destructive"
          className="h-9 text-xs"
          disabled={!!clearingDataset}
          onClick={() => handleClear("all", preferences.language === "en-US" ? "All Data" : "所有数据")}
        >
          <Trash2 size={14} /> {t("clearAll")}
        </Button>
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
    <div className="grid grid-cols-[32px_1fr] gap-2.5 items-center">
      <span className="grid place-items-center text-primary bg-primary/10 border border-primary/20 rounded-md w-8 h-8">{icon}</span>
      <div>
        <h2 className="m-0 text-foreground text-sm font-bold leading-tight">{title}</h2>
        <p className="m-0 mt-0.5 text-muted-foreground text-xs">{description}</p>
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
    <div className="min-w-0 grid grid-cols-[34px_1fr] gap-2.5 items-center p-3.5 bg-card border border-border rounded-lg">
      <span className="grid place-items-center text-primary bg-primary/10 border border-primary/20 rounded-md w-8 h-8">{icon}</span>
      <div>
        <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-[0.07em]">{label}</span>
        <strong className="block mt-0.5 text-lg font-bold text-foreground">{value}</strong>
        <small className="block mt-0.5 overflow-hidden text-muted-foreground text-[11px] text-ellipsis whitespace-nowrap">{detail}</small>
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
  const { t } = useTranslation();
  const preferences = usePreferences();
  const configured = ds.id === "AU9999" && aktools ? Boolean(aktools.reachable) : ds.providers.some((p) => p.configured);
  const coverageState = ds.dataCount === 0 ? "empty" : ds.historyDays >= 30 ? "good" : "partial";

  return (
    <div className={cn(
      "min-w-0 p-3.5 bg-background border rounded-lg flex flex-col gap-2.5 transition-colors",
      coverageState === "good" && "border-emerald-500/20",
      coverageState === "partial" && "border-amber-500/20",
      coverageState === "empty" && "border-border"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="m-0 text-foreground text-xs font-bold leading-normal">{ds.name}</h4>
          <span className="block mt-0.5 text-muted-foreground text-[11px]">{ds.activeProvider}</span>
        </div>
        <span className={cn(
          "flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border",
          configured
            ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
            : "text-amber-500 bg-amber-500/10 border-amber-500/20"
        )}>
          {configured ? t("available") : ds.id === "AU9999" && aktools?.configured ? t("unavailable") : t("notConfigured")}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <DatasetStatRow label={t("records")} value={`${ds.dataCount.toLocaleString()} ${preferences.language === "en-US" ? "items" : "条"}`} />
        <DatasetStatRow label={t("span")} value={ds.historyDays > 0 ? `${ds.historyDays} ${preferences.language === "en-US" ? "Days" : "天"}` : t("noHistory")} />
        <DatasetStatRow label={t("latest")} value={ds.latestData ? formatDateTime(ds.latestData) : t("noHistory")} />
        {ds.id === "AU9999" && aktools?.configured && (
          <DatasetStatRow label={t("api")} value={aktools.reachable ? (aktools.version ?? "OK") : (aktools.error ?? t("unavailable"))} />
        )}
      </div>

      <div className="h-1.25 overflow-hidden bg-muted rounded-full mt-1">
        <Progress value={Math.min(100, ds.historyDays)} className="h-[5px]" />
      </div>

      <div className="flex gap-1.5 mt-1.5">
        <Button variant="outline" className="h-8 text-xs flex-1" disabled={loading || clearing} onClick={onFetch}>
          {loading ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />} {t("refresh")}
        </Button>
        <Button variant="destructive" className="h-8 text-xs flex-1" disabled={loading || clearing} onClick={onClear}>
          {clearing ? <Loader size={12} className="spin" /> : <Trash2 size={12} />} {t("clear")}
        </Button>
      </div>
    </div>
  );
}

function DatasetStatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2.5 text-muted-foreground text-xs">
      <span>{label}</span>
      <strong className="max-w-[64%] overflow-hidden text-foreground/85 font-bold text-right text-ellipsis whitespace-nowrap">{value}</strong>
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
  const { t } = useTranslation();
  const preferences = usePreferences();
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

  React.useEffect(() => {
    function handleVisibilityChange() {
      if (!document.hidden && pollRef.current) {
        pollSyncJob().catch(console.error);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
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
      // Status is advisory
    }
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      if (document.hidden) return;
      await pollSyncJob();
    }, SYNC_STATUS_POLL_MS);
  }

  async function pollSyncJob() {
    const r = await fetch("/api/settings/data/sync-status");
    const job: SyncJob = await r.json();
    setSyncJob(job);
    if (job.status === "done") {
      stopPolling();
      setSubmitting(false);
      showToast(t("syncCompleteCount", { count: job.completedDays }));
      onDone();
    } else if (job.status === "error") {
      stopPolling();
      setSubmitting(false);
      showToast(job.error ?? t("syncFailed"), false);
    }
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
        const err = await res.json().catch(() => ({ error: preferences.language === "en-US" ? "Request failed" : "请求失败" }));
        throw new Error((err as any).error ?? preferences.language === "en-US" ? "Start sync failed" : "启动失败");
      }
      startPolling();
    } catch (err) {
      setSubmitting(false);
      showToast(err instanceof Error ? err.message : t("syncFailed"), false);
    }
  }

  const progressPct = syncJob && (syncJob.totalDays ?? 0) > 0
    ? Math.round(((syncJob.completedDays ?? 0) / (syncJob.totalDays ?? 1)) * 100)
    : 0;

  return (
    <form className="flex flex-col gap-3" onSubmit={handleStart}>
      <div className="grid grid-cols-1 gap-2.5">
        <div className="flex flex-col gap-1.5 min-w-0">
          <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("datasets")}</label>
          <Select value={datasetId} onValueChange={(value) => setDatasetId(value as any)} disabled={submitting}>
            <SelectTrigger className="h-9 border border-input rounded-md px-3 text-xs bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">XAU/USD + USD/CNH</SelectItem>
              <SelectItem value="XAU_USD">XAU/USD</SelectItem>
              <SelectItem value="USD_CNH">USD/CNH</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("startDate")}</label>
          <Input
            type="date"
            className="h-9 text-xs bg-background"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={submitting}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("endDate")}</label>
          <Input
            type="date"
            className="h-9 text-xs bg-background"
            value={endDate}
            min={startDate}
            max={today}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={submitting}
            required
          />
        </div>
      </div>

      <div className="h-[1px] bg-border my-1" />

      <div className="grid grid-cols-2 gap-2">
        {[
          { label: t("preset_30days"), days: 30 },
          { label: t("preset_90days"), days: 90 },
          { label: t("preset_180days"), days: 180 },
          { label: t("preset_365days"), days: 365 }
        ].map((p) => (
          <Button
            key={p.days}
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs w-full"
            disabled={submitting}
            onClick={() => {
              setEndDate(today);
              setStartDate(toDateStr(new Date(Date.now() - p.days * 86_400_000)));
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {syncJob && (
        <div className="p-2.5 bg-primary/10 border border-primary/20 rounded-md flex flex-col gap-2 my-1">
          <div className="flex justify-between gap-2.5 text-muted-foreground text-xs">
            <span>{syncJob.status === "done" ? t("syncComplete") : syncJob.currentDay ? `${t("syncing")} ${syncJob.currentDay}` : t("preparing")}</span>
            <strong className="text-foreground font-bold">{syncJob.completedDays ?? 0} / {syncJob.totalDays ?? 0} {preferences.language === "en-US" ? "Days" : "天"}</strong>
          </div>
          <div className="h-1.25 overflow-hidden bg-muted rounded-full">
            <Progress value={progressPct} className="h-[5px]" />
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <p className="m-0 text-muted-foreground text-[10px] leading-tight">{t("au9999SyncNote")}</p>
        <Button type="submit" className="w-full text-xs h-9 font-semibold" disabled={submitting}>
          {submitting ? <><Loader size={14} className="spin mr-1" /> {t("syncing")}</> : <><Calendar size={14} className="mr-1" /> {t("startSync")}</>}
        </Button>
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
  const { t } = useTranslation();
  const preferences = usePreferences();
  const [time, setTime] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [source, setSource] = React.useState(preferences.language === "en-US" ? "Manual Supplement" : "手动补录");
  const [category, setCategory] = React.useState(preferences.language === "en-US" ? "Gold Market" : "黄金市场");
  const [direction, setDirection] = React.useState("bullish");
  const [impact, setImpact] = React.useState("30");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    setSource(preferences.language === "en-US" ? "Manual Supplement" : "手动补录");
    setCategory(preferences.language === "en-US" ? "Gold Market" : "黄金市场");
  }, [preferences.language]);

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
      showToast(t("eventWritten"));
      setTime("");
      setTitle("");
      onDone();
    } catch {
      showToast(t("supplementFailed"), false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1.5 min-w-0">
        <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("eventTime")}</label>
        <Input type="datetime-local" className="h-9 text-xs bg-background" value={time} onChange={(e) => setTime(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("title")}</label>
        <Input type="text" className="h-9 text-xs bg-background" placeholder={preferences.language === "en-US" ? "e.g., Fed announces 25bp hike" : "例如：美联储宣布加息25bp"} value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("source")}</label>
        <Input type="text" className="h-9 text-xs bg-background" placeholder="Reuters / Manual" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>
      <div className="grid grid-cols-[1fr_1fr_0.7fr] gap-2">
        <div className="flex flex-col gap-1.5 min-w-0">
          <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("category")}</label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 border border-input rounded-md px-3 text-xs bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(preferences.language === "en-US"
                ? ["Gold Market", "Federal Reserve", "US Dollar", "US Treasury", "Inflation", "Geopolitics"]
                : ["黄金市场", "美联储", "美元", "美债", "通胀", "地缘政治"]
              ).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("direction")}</label>
          <Select value={direction} onValueChange={setDirection}>
            <SelectTrigger className="h-9 border border-input rounded-md px-3 text-xs bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bullish">{t("bullish")}</SelectItem>
              <SelectItem value="bearish">{t("bearish")}</SelectItem>
              <SelectItem value="neutral">{t("neutral")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("impact")}</label>
          <Input type="number" min="-100" max="100" className="h-9 text-xs bg-background" value={impact} onChange={(e) => setImpact(e.target.value)} />
        </div>
      </div>
      <Button type="submit" className="h-9 text-xs font-semibold w-full mt-1.5" disabled={submitting}>
        {submitting ? <Loader size={14} className="spin mr-1" /> : <Plus size={14} className="mr-1" />} {preferences.language === "en-US" ? "Save Event" : "写入事件"}
      </Button>
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
  const { t } = useTranslation();
  const preferences = usePreferences();
  if (!events.length) {
    return <div className="flex items-center justify-center p-8 bg-background border border-border rounded-lg text-muted-foreground text-xs">{t("noData")}</div>;
  }

  return (
    <div className="min-w-0 overflow-auto border border-border rounded-lg bg-background max-h-[385px]">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="sticky top-0 z-10 p-2.5 text-muted-foreground text-[10px] font-extrabold tracking-wider text-left uppercase">{t("time")}</th>
            <th className="sticky top-0 z-10 p-2.5 text-muted-foreground text-[10px] font-extrabold tracking-wider text-left uppercase">{t("source")}</th>
            <th className="sticky top-0 z-10 p-2.5 text-muted-foreground text-[10px] font-extrabold tracking-wider text-left uppercase">{t("title")}</th>
            <th className="sticky top-0 z-10 p-2.5 text-muted-foreground text-[10px] font-extrabold tracking-wider text-left uppercase">{t("category")}</th>
            <th className="sticky top-0 z-10 p-2.5 text-muted-foreground text-[10px] font-extrabold tracking-wider text-left uppercase">{t("direction")}</th>
            <th className="sticky top-0 z-10 p-2.5 text-muted-foreground text-[10px] font-extrabold tracking-wider text-left uppercase">{t("impact")}</th>
            <th className="sticky top-0 z-10 p-2.5 text-muted-foreground text-[10px] font-extrabold tracking-wider text-left uppercase"></th>
          </tr>
        </thead>
        <tbody>
          {events.slice(0, 30).map((ev) => (
            <tr key={ev.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
              <td className="p-2.5 text-muted-foreground whitespace-nowrap">{formatDateTime(ev.time)}</td>
              <td className="p-2.5 text-muted-foreground whitespace-nowrap">{ev.source}</td>
              <td className="p-2.5 text-foreground max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                {ev.url
                  ? <a href={ev.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{ev.title}</a>
                  : ev.title}
              </td>
              <td className="p-2.5 text-muted-foreground whitespace-nowrap">{ev.category}</td>
              <td className="p-2.5 whitespace-nowrap">
                <span className={cn(
                  "inline-flex items-center min-h-[20px] px-2 py-0.5 rounded text-[10px] font-bold border",
                  ev.direction === "bullish" && "text-destructive bg-destructive/10 border-destructive/20",
                  ev.direction === "bearish" && "text-success bg-success/10 border-success/20",
                  ev.direction === "neutral" && "text-muted-foreground bg-muted border-border"
                )}>
                  {t(ev.direction)}
                </span>
              </td>
              <td className={cn(
                "p-2.5 whitespace-nowrap font-extrabold",
                ev.impact > 0 && "text-destructive",
                ev.impact < 0 && "text-success",
                ev.impact === 0 && "text-muted-foreground"
              )}>
                {ev.impact > 0 ? `+${ev.impact}` : ev.impact}
              </td>
              <td className="p-2.5 whitespace-nowrap text-right">
                <Button variant="destructive" size="compactIcon" className="h-6 w-6" onClick={() => onDelete(ev.id)} title={t("delete")} aria-label="Delete event">
                  <Trash2 size={12} />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length > 30 && <p className="m-0 p-2.5 text-muted-foreground border-t border-border text-center text-xs bg-muted/10">{preferences.language === "en-US" ? `Showing latest 30 of ${events.length} events` : `仅展示最新 30 条，共 ${events.length} 条事件`}</p>}
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
