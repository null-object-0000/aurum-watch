import React from "react";
import { CheckCircle, XCircle, Loader, AlertCircle, Calendar } from "lucide-react";
import type { InitStatus } from "../App";

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
    }, 800);
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
    { label: "GDELT 新闻源", ok: true, hint: "公开免费，无需配置" }
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
              <span style={{ flex: 1 }}>{c.label}</span>
              <span style={{ fontSize: 11, color: c.ok ? "#31b978" : "#e2b13c" }}>{c.hint}</span>
            </div>
          ))}
          {status.historyMinutesCount === 0 && (
            <div className="init-check-item warn">
              <span className="init-check-dot warn" />
              <span style={{ flex: 1 }}>历史行情库</span>
              <span style={{ fontSize: 11, color: "#e2b13c" }}>暂无数据</span>
            </div>
          )}
          {status.historyMinutesCount > 0 && status.historyDays < RECOMMENDED_DAYS && (
            <div className="init-check-item warn">
              <span className="init-check-dot warn" />
              <span style={{ flex: 1 }}>历史数据跨度</span>
              <span style={{ fontSize: 11, color: "#e2b13c" }}>
                当前约 {status.historyDays} 天，建议至少 {RECOMMENDED_DAYS} 天
              </span>
            </div>
          )}
          {status.historyDays >= RECOMMENDED_DAYS && (
            <div className="init-check-item ok">
              <span className="init-check-dot ok" />
              <span style={{ flex: 1 }}>历史数据跨度</span>
              <span style={{ fontSize: 11, color: "#31b978" }}>{status.historyDays} 天 ✓</span>
            </div>
          )}
        </div>

        {/* Date range selector */}
        {!syncing && !isDone && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Calendar size={14} color="#5b6880" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "#7e8998", flexShrink: 0 }}>同步历史</span>
            <select
              className="form-select"
              value={customDays}
              onChange={(e) => setCustomDays(Number(e.target.value))}
              style={{ width: "auto", flex: 1 }}
            >
              <option value={30}>最近 30 天</option>
              <option value={90}>最近 90 天（推荐）</option>
              <option value={180}>最近 180 天</option>
              <option value={365}>最近 365 天</option>
            </select>
          </div>
        )}

        {/* Progress */}
        {syncJob && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#7e8998" }}>
              <span>
                {isDone ? "同步完成" : syncJob.currentDay ? `正在同步 ${syncJob.currentDay}` : "准备中..."}
              </span>
              <span>{syncJob.completedDays} / {syncJob.totalDays} 天</span>
            </div>
            <div style={{ height: 6, background: "#1a2330", borderRadius: 4, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progressPct}%`,
                  background: isDone ? "#31b978" : "linear-gradient(90deg, #1f5799, #2468b3)",
                  borderRadius: 4,
                  transition: "width 0.3s ease"
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["XAU/USD", "USD/CNH"] as const).map((sym) => (
                <span key={sym} style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: "rgba(30,60,110,0.3)", color: "#6faad6"
                }}>{sym} · 分钟级 M1</span>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: 8, background: "rgba(180,40,50,0.1)", border: "1px solid rgba(180,40,50,0.25)" }}>
            <AlertCircle size={15} color="#ef6b72" style={{ flexShrink: 0, marginTop: 1 }} />
            <span className="text-error">{error}</span>
          </div>
        )}

        {/* Action */}
        <button
          id="init-start-btn"
          className="btn btn-primary btn-lg"
          disabled={syncing || isDone}
          onClick={handleStart}
          style={{ width: "100%" }}
        >
          {syncing && !isDone && <><Loader size={15} className="spin" /> 正在逐天同步历史数据...</>}
          {isDone && <><CheckCircle size={15} /> 初始化完成，即将进入看板...</>}
          {!syncing && !isDone && <>开始初始化 · 逐天拉取行情（约 {customDays} 天）</>}
        </button>

        <p className="text-muted" style={{ textAlign: "center", margin: 0, fontSize: 12 }}>
          行情数据按分钟落库，完成后永久保留于本地 SQLite。<br />仅当天的实时数据会联网更新。
        </p>
      </div>
    </div>
  );
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
