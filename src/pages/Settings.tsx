import React from "react";
import { Activity, Clock3, Database, HardDrive, Server, Wifi } from "lucide-react";
import { usePreferences } from "../preferences";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

export function Settings() {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const [settingsData, setSettingsData] = React.useState<SettingsData | null>(null);
  const [runtimeSettings, setRuntimeSettings] = React.useState<RuntimeSettings | null>(null);

  React.useEffect(() => {
    Promise.all([
      fetch("/api/settings/data").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json())
    ])
      .then(([dataRes, settingsRes]) => {
        setSettingsData(dataRes as SettingsData);
        setRuntimeSettings(settingsRes as RuntimeSettings);
      })
      .catch(console.error);
  }, []);

  const sources = [
    {
      name: "OANDA",
      status: runtimeSettings?.oanda?.configured ? "ok" : "warn",
      detail: runtimeSettings?.oanda?.configured 
        ? `${t("available")} · ${runtimeSettings.oanda.env}` 
        : t("resolvedLanguage") === "en-US" ? "OANDA_API_TOKEN not configured" : "未配置 OANDA_API_TOKEN"
    },
    {
      name: "AKTools / SGE",
      status: runtimeSettings?.au9999?.reachable ? "ok" : "warn",
      detail: runtimeSettings?.au9999?.reachable
        ? (runtimeSettings.au9999.version ?? (t("resolvedLanguage") === "en-US" ? "API works" : "接口可用"))
        : (runtimeSettings?.au9999?.error ?? (t("resolvedLanguage") === "en-US" ? "Unreachable or not configured" : "未配置或不可用"))
    },
    {
      name: "GDELT",
      status: "ok",
      detail: runtimeSettings?.news?.query 
        ? `query: ${runtimeSettings.news.query}` 
        : t("resolvedLanguage") === "en-US" ? "Public news sources" : "公开新闻源"
    }
  ];

  return (
    <div className="w-full max-w-7xl mx-auto py-2.5 pb-7 flex flex-col gap-3.5 px-4 md:px-0">
      <header className="flex items-end justify-between gap-4.5 pt-1.5 pb-0.5 px-0.5">
        <div>
          <p className="m-0 mb-1 text-[11px] font-bold tracking-[0.11em] uppercase text-slate-500">Application Settings</p>
          <h1 className="m-0 text-2xl font-bold leading-tight text-foreground">{t("settingsTitle")}</h1>
          <p className="m-0 mt-1.5 text-xs text-muted-foreground">{t("settingsDesc")}</p>
        </div>
      </header>

      <section className="min-w-0 bg-card border border-border rounded-lg p-3.5 flex flex-col gap-3.5">
        <SectionHeader
          icon={<Activity size={16} />}
          title={t("preferences")}
          description={t("preferencesDesc")}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <div className="flex flex-col gap-1.5 min-w-0">
            <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("theme")}</label>
            <Select value={preferences.theme} onValueChange={(value) => preferences.setTheme(value as any)}>
              <SelectTrigger className="h-9 border border-input rounded-md px-3 text-xs bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("system")}</SelectItem>
                <SelectItem value="dark">{t("dark")}</SelectItem>
                <SelectItem value="light">{t("light")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("language")}</label>
            <Select value={preferences.language} onValueChange={(value) => preferences.setLanguage(value as any)}>
              <SelectTrigger className="h-9 border border-input rounded-md px-3 text-xs bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("system")}</SelectItem>
                <SelectItem value="zh-CN">{t("zh-CN")}</SelectItem>
                <SelectItem value="en-US">{t("en-US")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.06em]">{t("marketColors")}</label>
            <Select value={preferences.marketColors} onValueChange={(value) => preferences.setMarketColors(value as any)}>
              <SelectTrigger className="h-9 border border-input rounded-md px-3 text-xs bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="red-up">{t("redUp")}</SelectItem>
                <SelectItem value="green-up">{t("greenUp")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="min-w-0 bg-card border border-border rounded-lg p-3.5 flex flex-col gap-3.5">
        <SectionHeader
          icon={<Wifi size={16} />}
          title={t("connectionStatus")}
          description={t("connectionStatusDesc")}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {sources.map((source) => (
            <div className="min-w-0 grid grid-cols-[10px_1fr] gap-2.5 items-center p-3.5 bg-background border border-border rounded-lg" key={source.name}>
              <span className={`w-2 h-2 rounded-full ${source.status === "ok" ? "bg-emerald-500" : "bg-amber-500"}`} />
              <div>
                <strong className="block text-foreground text-xs font-bold">{source.name}</strong>
                <small className="block mt-0.5 overflow-hidden text-muted-foreground text-[11px] text-ellipsis whitespace-nowrap">{source.detail}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <OverviewMetric icon={<HardDrive size={17} />} label={t("database")} value={`${settingsData?.database.sizeMb ?? "--"} MB`} detail={settingsData?.database.path ?? runtimeSettings?.storage?.databasePath ?? t("loading")} />
        <OverviewMetric icon={<Database size={17} />} label={t("datasets")} value={`${settingsData?.datasets.length ?? "--"}`} detail={t("canMaintainInDataPage")} />
        <OverviewMetric icon={<Server size={17} />} label={t("runMode")} value={runtimeSettings?.oanda?.env ?? "--"} detail="OANDA environment" />
        <OverviewMetric icon={<Clock3 size={17} />} label={t("version")} value="0.1.0" detail="Aurum Watch build version" />
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
