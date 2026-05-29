import React from "react";
import { AlertCircle, CalendarClock, CheckCircle, Clock3, Database, Radio, Repeat2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../preferences";

const TASKS_POLL_MS = 1000;

type TaskStatus = "idle" | "running" | "done" | "error" | "stopped";

interface HistoryTask {
  id: string;
  kind: "history_sync";
  name: string;
  description: string;
  status: TaskStatus;
  datasetId: string | null;
  startDate: string | null;
  endDate: string | null;
  totalDays: number;
  completedDays: number;
  currentDay: string | null;
  error: string | null;
  startedAt: string | null;
}

interface RuntimeTask {
  id: string;
  kind: "realtime_worker" | "scheduled_sync";
  name: string;
  status: TaskStatus;
  detail?: string;
  intervalMs?: number;
  nextRunAt?: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

interface TasksPayload {
  updatedAt: string;
  history: HistoryTask;
  realtime: RuntimeTask[];
  scheduled: RuntimeTask[];
}

export function Tasks() {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const [payload, setPayload] = React.useState<TasksPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let pollRef: ReturnType<typeof setInterval> | null = null;

    async function loadTasks() {
      try {
        const next = await fetch("/api/tasks").then((r) => r.json()) as TasksPayload;
        if (!cancelled) {
          setPayload(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : preferences.language === "en-US" ? "Failed to read task status" : "任务状态读取失败");
      }
    }

    loadTasks();
    pollRef = setInterval(() => {
      if (!document.hidden) loadTasks();
    }, TASKS_POLL_MS);

    function handleVisibilityChange() {
      if (!document.hidden) loadTasks();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      if (pollRef) clearInterval(pollRef);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [t]);

  const history = payload?.history;
  const progressPct = history && history.totalDays > 0
    ? Math.round((history.completedDays / history.totalDays) * 100)
    : 0;
  const runningRealtime = payload?.realtime.filter((task) => task.status === "running").length ?? 0;
  const failingTasks = [...(payload?.realtime ?? []), ...(payload?.scheduled ?? [])].filter((task) => task.status === "error").length;

  return (
    <div className="w-full max-w-7xl mx-auto py-2.5 pb-7 flex flex-col gap-3.5 px-4 md:px-0">
      <header className="flex items-end justify-between gap-4.5 pt-1.5 pb-0.5 px-0.5 flex-wrap">
        <div>
          <p className="m-0 mb-1 text-[11px] font-bold tracking-[0.11em] uppercase text-slate-500">Background Jobs</p>
          <h1 className="m-0 text-2xl font-bold leading-tight text-foreground">{t("tasksTitle")}</h1>
          <p className="m-0 mt-1.5 text-xs text-muted-foreground">{t("tasksDesc")}</p>
        </div>
      </header>

      {error && (
        <div className="min-h-[40px] flex items-center gap-2 p-2.5 text-destructive bg-destructive/10 border border-destructive/20 rounded-lg text-xs font-bold">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <OverviewMetric icon={<Database size={17} />} label={t("historySync")} value={history ? t(`status_${history.status}`) : "--"} detail={history?.currentDay ? `${t("syncing")} ${history.currentDay}` : t("historySyncDesc")} />
        <OverviewMetric icon={<Radio size={17} />} label={t("realtimeTasks")} value={`${runningRealtime}/${payload?.realtime.length ?? 0}`} detail={t("realtimeTasksDesc")} />
        <OverviewMetric icon={<Repeat2 size={17} />} label={t("scheduledTasks")} value={`${payload?.scheduled.length ?? 0}`} detail={t("scheduledTasksDesc")} />
        <OverviewMetric icon={<Clock3 size={17} />} label={t("updatedTime")} value={payload?.updatedAt ? formatTime(payload.updatedAt) : "--"} detail={failingTasks ? `${failingTasks} ${t("tasksAbnormal")}` : t("tasksRefreshDesc")} />
      </section>

      <section className="min-w-0 bg-card border border-border rounded-lg p-3.5 flex flex-col gap-3.5">
        <SectionHeader
          icon={<Radio size={16} />}
          title={t("realtimeTasksTitle")}
          description={t("realtimeTasksDescLong")}
        />
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
          {(payload?.realtime ?? []).map((task) => <TaskCard key={task.id} task={task} />)}
        </div>
      </section>

      <section className="min-w-0 bg-card border border-border rounded-lg p-3.5 flex flex-col gap-3.5">
        <SectionHeader
          icon={<CalendarClock size={16} />}
          title={t("scheduledTasksTitle")}
          description={t("scheduledTasksDescLong")}
        />
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
          {(payload?.scheduled ?? []).map((task) => <TaskCard key={task.id} task={task} />)}
        </div>
      </section>

      <section className="min-w-0 bg-card border border-border rounded-lg p-3.5 flex flex-col gap-3.5 bg-gradient-to-b from-card/90 to-card">
        <SectionHeader
          icon={<Database size={16} />}
          title={t("historySyncTasksTitle")}
          description={t("historySyncTasksDesc")}
        />
        {!history || history.status === "idle" ? (
          <div className="flex items-center justify-center p-8 bg-background border border-border rounded-lg text-muted-foreground text-xs">{t("noHistorySyncTasks")}</div>
        ) : (
          <div className="p-2.5 bg-primary/10 border border-primary/20 rounded-md flex flex-col gap-2.5">
            <div className="flex justify-between gap-2.5 text-muted-foreground text-xs">
              <span>{history.currentDay ? `${t("syncing")} ${history.currentDay}` : t(`status_${history.status}`)}</span>
              <strong className="text-foreground font-bold">{history.completedDays} / {history.totalDays} {preferences.language === "en-US" ? "Days" : "天"}</strong>
            </div>
            <div className="h-1.25 overflow-hidden bg-muted rounded-full">
              <Progress value={progressPct} className="h-[5px]" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 border-t border-border/40 pt-2">
              <TaskFact label={t("status")} value={t(`status_${history.status}`)} />
              <TaskFact label={t("datasets")} value={history.datasetId ?? "--"} />
              <TaskFact label={t("range")} value={history.startDate && history.endDate ? `${history.startDate} ${preferences.language === "en-US" ? "to" : "至"} ${history.endDate}` : "--"} />
              <TaskFact label={t("start")} value={history.startedAt ? formatDateTime(history.startedAt) : "--"} />
              {history.error && <TaskFact label={t("error")} value={history.error} className="sm:col-span-2 text-destructive" />}
            </div>
          </div>
        )}
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

function TaskCard({ task }: { task: RuntimeTask }) {
  const { t } = useTranslation();
  const preferences = usePreferences();
  return (
    <Card className={cn(
      "min-w-0 border bg-card text-card-foreground shadow-sm",
      task.status === "running" && "border-emerald-500/25",
      task.status === "error" && "border-destructive/30",
      task.status === "stopped" && "border-amber-500/25"
    )}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-3.5">
        <div className="min-w-0">
          <CardTitle className="text-sm font-bold text-foreground leading-normal truncate">{task.name}</CardTitle>
          {task.detail && <CardDescription className="mt-1 text-xs text-muted-foreground line-clamp-1">{task.detail}</CardDescription>}
        </div>
        <StatusBadge status={task.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 p-3.5 pt-0">
        {task.intervalMs !== undefined && <TaskFact label={t("interval")} value={formatInterval(task.intervalMs, preferences.language)} />}
        <TaskFact label={t("lastSuccess")} value={task.lastSuccessAt ? formatDateTime(task.lastSuccessAt) : "--"} />
        {task.nextRunAt !== undefined && <TaskFact label={t("nextRun")} value={task.nextRunAt ? formatDateTime(task.nextRunAt) : "--"} />}
        {task.lastError && <TaskFact label={t("error")} value={task.lastError} />}
      </CardContent>
    </Card>
  );
}


function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  const icon = status === "running"
    ? <span className="w-1.75 h-1.75 rounded-full bg-emerald-500 mr-1.5 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]" />
    : status === "error"
    ? <AlertCircle size={12} className="mr-1" />
    : status === "stopped"
      ? <span className="w-1.75 h-1.75 rounded-full bg-amber-500 mr-1.5" />
    : status === "done"
      ? <CheckCircle size={12} className="mr-1" />
      : <span className="w-1.75 h-1.75 rounded-full bg-slate-400 mr-1.5" />;
  const variant = status === "running" || status === "done"
    ? "success"
    : status === "error"
      ? "destructive"
      : status === "stopped"
        ? "warning"
      : "secondary";
  return <Badge variant={variant} className="h-5 text-[10px] px-1.5 font-bold uppercase">{icon}{t(`status_${status}`)}</Badge>;
}

function TaskFact({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("min-w-0 flex justify-between gap-2.5 text-muted-foreground text-xs", className)}>
      <span>{label}</span>
      <strong className="max-w-[68%] overflow-hidden text-foreground/80 font-bold text-right text-ellipsis whitespace-nowrap">{value}</strong>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatInterval(ms: number, lang: string) {
  const isEn = lang === "en-US";
  if (ms < 60_000) return `${Math.round(ms / 1000)} ${isEn ? "secs" : "秒"}`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} ${isEn ? "mins" : "分钟"}`;
  return `${Math.round(ms / 3_600_000)} ${isEn ? "hours" : "小时"}`;
}
