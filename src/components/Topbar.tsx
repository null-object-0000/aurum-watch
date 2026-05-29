import React from "react";
import { Settings } from "lucide-react";
import { formatClock } from "../utils/format";
import type { DashboardPayload } from "../types";
import { usePreferences } from "../preferences";

interface TopbarProps {
  data: DashboardPayload | null;
  activeTab: "dashboard" | "settings" | "init";
  initialized: boolean;
  onTabChange: (tab: "dashboard" | "settings") => void;
}

export function Topbar({ data, activeTab, initialized, onTabChange }: TopbarProps) {
  const [now, setNow] = React.useState(() => new Date());
  const { t } = usePreferences();

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const isSettings = activeTab === "settings";

  return (
    <header className="topbar">
      <div className="brand">
        <img src="/icon.svg" alt="" />
        <div>
          <strong>金哨 Aurum Watch</strong>
          <span>{t("brandSubtitle")}</span>
        </div>
      </div>
      <div className="topbar-right">
        <b className={data ? "dot ok" : "dot error"} />
        <strong>{formatClock(now)}</strong>
        <button
          id="settings-btn"
          className={`settings-btn${isSettings ? " active" : ""}`}
          title={isSettings ? t("dashboard") : t("settings")}
          disabled={!initialized}
          onClick={() => onTabChange(isSettings ? "dashboard" : "settings")}
          aria-label={t("settings")}
        >
          <Settings size={16} className="settings-icon" />
        </button>
        <span className="avatar">A</span>
      </div>
    </header>
  );
}
