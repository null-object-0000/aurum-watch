import React from "react";
import { CheckCircle, XCircle, Loader, AlertCircle, Calendar } from "lucide-react";
import type { InitStatus } from "../App";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface InitPortalProps {
  status: InitStatus;
  onDone: () => void;
  onStatusRefresh: () => void;
}

interface SyncJob {
  status: "running" | "done" | "error" | "idle";
  totalDays: number;
  completedDays: number;
  currentDay: string | null;
  error: string | null;
}

// 推荐初始化天数
const RECOMMENDED_DAYS = 90;
const SYNC_STATUS_POLL_MS = 1000;

export function InitPortal({ status, onDone, onStatusRefresh }: InitPortalProps) {
  const [syncing, setSyncing] = React.useState(false);
  const [syncJob, setSyncJob] = React.useState<SyncJob | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [customDays, setCustomDays] = React.useState(RECOMMENDED_DAYS);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // 清理轮询
  React.useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
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

  React.useEffect(() => {
    let cancelled = false;

    async function loadExistingSyncJob() {
      try {
        const res = await fetch("/api/settings/data/sync-status");
        if (!res.ok) return;

        const job: SyncJob = await res.json();
        if (cancelled || job.status === "idle") return;

        setSyncJob(job);
        if (job.status === "running") {
          setSyncing(true);
          startPolling();
        } else if (job.status === "error") {
          setError(job.error ?? "同步失败");
        } else if (job.status === "done") {
          onStatusRefresh();
          setTimeout(onDone, 1500);
        }
      } catch {
        // The normal init checks still render if sync status is temporarily unavailable.
      }
    }

    loadExistingSyncJob();

    return () => { cancelled = true; };
  }, [onDone, onStatusRefresh]);

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      if (document.hidden) return;
      await pollSyncJob();
    }, SYNC_STATUS_POLL_MS);
  }

  async function pollSyncJob() {
    const res = await fetch("/api/settings/data/sync-status");
    const job: SyncJob = await res.json();
    setSyncJob(job);

    if (job.status === "done") {
      stopPolling();
      setSyncing(false);
      onStatusRefresh();
      setTimeout(onDone, 1500);
    } else if (job.status === "error") {
      stopPolling();
      setSyncing(false);
      setError(job.error ?? "同步失败");
    }
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function handleStart() {
    setSyncing(true);
    setError(null);
    setSyncJob(null);

    const endDate = toDateStr(new Date());
    const startDate = toDateStr(new Date(Date.now() - customDays * 86_400_000));

    try {
      const res = await fetch("/api/settings/data/sync-range", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId: "all", startDate, endDate })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "请求失败" }));
        throw new Error((err as any).error ?? "同步失败");
      }
      startPolling();
    } catch (err) {
      setSyncing(false);
      setError(err instanceof Error ? err.message : "未知错误");
    }
  }

  const checks = [
    {
      label: "OANDA API Token",
      ok: status.oandaConfigured,
      hint: status.oandaConfigured ? "已配置" : "未配置 — 国际金价将跳过"
    },
    {
      label: "AKTools SGE",
      ok: Boolean(status.au9999Configured && status.au9999Reachable),
      hint: !status.au9999Configured
        ? "未配置 — 国内金价将跳过"
        : status.au9999Reachable
          ? `可用${status.aktoolsVersion ? ` · ${status.aktoolsVersion}` : ""}`
          : `不可用${status.aktoolsError ? ` · ${status.aktoolsError}` : ""}`
    },
    { label: "NewsNow 新闻源", ok: true, hint: "公开免费，无需配置" }
  ];

  const progressPct = syncJob && syncJob.totalDays > 0
    ? Math.round((syncJob.completedDays / syncJob.totalDays) * 100)
    : 0;

  const isDone = syncJob?.status === "done";

  return (
    <div className="init-portal">
      <div className="init-portal-box">
        {/* Logo */}
        <div className="init-portal-logo">
          <img src="/icon.svg" alt="" />
          <div>
            <h1>金哨 Aurum Watch</h1>
            <p>首次使用需要初始化历史数据</p>
          </div>
        </div>

        {/* Config Checks */}
        <div className="init-check-list">
          {checks.map((c) => (
            <div key={c.label} className={`init-check-item ${c.ok ? "ok" : "warn"}`}>
              <span className={`init-check-dot ${c.ok ? "ok" : "warn"}`} />
              <span className="flex-1">{c.label}</span>
              <span className={c.ok ? "text-xs text-success" : "text-xs text-warning"}>{c.hint}</span>
            </div>
          ))}
          {status.historyMinutesCount === 0 && (
            <div className="init-check-item warn">
              <span className="init-check-dot warn" />
              <span className="flex-1">历史行情库</span>
              <span className="text-xs text-warning">暂无数据</span>
            </div>
          )}
          {status.historyMinutesCount > 0 && status.historyDays < RECOMMENDED_DAYS && (
            <div className="init-check-item warn">
              <span className="init-check-dot warn" />
              <span className="flex-1">历史数据跨度</span>
              <span className="text-xs text-warning">
                当前约 {status.historyDays} 天，建议至少 {RECOMMENDED_DAYS} 天
              </span>
            </div>
          )}
          {status.historyDays >= RECOMMENDED_DAYS && (
            <div className="init-check-item ok">
              <span className="init-check-dot ok" />
              <span className="flex-1">历史数据跨度</span>
              <span className="text-xs text-success">{status.historyDays} 天 ✓</span>
            </div>
          )}
        </div>

        {/* Date range selector */}
        {!syncing && !isDone && (
          <div className="flex items-center gap-2.5">
            <Calendar size={14} className="shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-sm text-muted-foreground">同步历史</span>
            <Select value={String(customDays)} onValueChange={(value) => setCustomDays(Number(value))}>
              <SelectTrigger className="form-select flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">最近 30 天</SelectItem>
                <SelectItem value="90">最近 90 天（推荐）</SelectItem>
                <SelectItem value="180">最近 180 天</SelectItem>
                <SelectItem value="365">最近 365 天</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Progress */}
        {syncJob && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {isDone ? "同步完成" : syncJob.currentDay ? `正在同步 ${syncJob.currentDay}` : "准备中..."}
              </span>
              <span>{syncJob.completedDays} / {syncJob.totalDays} 天</span>
            </div>
            <Progress
              value={progressPct}
              className="h-1.5"
              indicatorClassName={isDone ? "bg-success" : "bg-primary"}
            />
            <div className="flex flex-wrap gap-1.5">
              {(["XAU/USD", "USD/CNH"] as const).map((sym) => (
                <span key={sym} className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">{sym} · 分钟级 M1</span>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-destructive" />
            <span className="text-error">{error}</span>
          </div>
        )}

        {/* Action */}
        <Button
          id="init-start-btn"
          className="w-full"
          size="lg"
          disabled={syncing || isDone}
          onClick={handleStart}
        >
          {syncing && !isDone && <><Loader size={15} className="spin" /> 正在逐天同步历史数据...</>}
          {isDone && <><CheckCircle size={15} /> 初始化完成，即将进入看板...</>}
          {!syncing && !isDone && <>开始初始化 · 逐天拉取行情（约 {customDays} 天）</>}
        </Button>

        <p className="m-0 text-center text-xs text-muted-foreground">
          行情数据按分钟落库，完成后永久保留于本地 SQLite。<br />仅当天的实时数据会联网更新。
        </p>
      </div>
    </div>
  );
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
