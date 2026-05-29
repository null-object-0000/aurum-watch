import React from "react";
import { BarChart3, Database, Languages, ListChecks, Menu, Moon, Settings, Sun, X } from "lucide-react";
import { formatClock } from "../utils/format";
import type { DashboardPayload } from "../types";
import { usePreferences } from "../preferences";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type AppRoute = "dashboard" | "data" | "tasks" | "settings";

interface TopbarProps {
  data: DashboardPayload | null;
  activeTab: AppRoute | "init";
  initialized: boolean;
  onTabChange: (tab: AppRoute) => void;
}

export function Topbar({ data, activeTab, initialized, onTabChange }: TopbarProps) {
  const [now, setNow] = React.useState(() => new Date());
  const [menuOpen, setMenuOpen] = React.useState(false);
  const preferences = usePreferences();
  const { t } = useTranslation();

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const navItems: Array<{ route: AppRoute; labelKey: string; icon: React.ReactNode }> = [
    { route: "dashboard", labelKey: "dashboardTab", icon: <BarChart3 size={15} /> },
    { route: "data", labelKey: "dataTab", icon: <Database size={15} /> },
    { route: "tasks", labelKey: "tasksTab", icon: <ListChecks size={15} /> }
  ];

  function handleNavigate(route: AppRoute) {
    setMenuOpen(false);
    onTabChange(route);
  }

  return (
    <header className="topbar">
      <div
        className={cn("brand", initialized && "interactive")}
        onClick={() => initialized && onTabChange("dashboard")}
      >
        <img src="/icon.svg" alt="" />
        <div>
          <strong>金哨 Aurum Watch</strong>
          <span>{t("brandSubtitle")}</span>
        </div>
      </div>
      <nav className={cn("topbar-nav", menuOpen && "open")} aria-label="主导航">
        {navItems.map((item) => (
          <Button
            key={item.route}
            className={cn(
              "h-9 px-3 text-xs",
              activeTab === item.route && "bg-accent text-accent-foreground border border-ring/40"
            )}
            variant="ghost"
            disabled={!initialized}
            onClick={() => handleNavigate(item.route)}
            type="button"
          >
            {item.icon}
            <span>{t(item.labelKey)}</span>
          </Button>
        ))}
      </nav>
      <div className="topbar-right">
        <b className={data ? "dot ok" : "dot error"} />
        <strong>{formatClock(now)}</strong>
        <Button
          variant="outline"
          size="compactIcon"
          className="h-8 w-8 border-border text-muted-foreground hover:text-foreground"
          disabled={!initialized}
          onClick={() => preferences.setTheme(preferences.theme === "dark" ? "light" : "dark")}
          title={preferences.theme === "dark" ? t("light") : t("dark")}
          aria-label={t("theme")}
          type="button"
        >
          {preferences.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </Button>
        <Button
          variant="outline"
          size="compactIcon"
          className="h-8 w-8 border-border text-muted-foreground hover:text-foreground"
          disabled={!initialized}
          onClick={() => preferences.setLanguage(preferences.language === "zh-CN" ? "en-US" : "zh-CN")}
          title={preferences.language === "zh-CN" ? "English" : "中文"}
          aria-label={t("language")}
          type="button"
        >
          <Languages size={15} />
        </Button>
        <Button
          className="topbar-menu-btn"
          variant="secondary"
          size="compactIcon"
          type="button"
          disabled={!initialized}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={17} /> : <Menu size={17} />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className={cn("avatar", activeTab === "settings" && "active")}
              type="button"
              disabled={!initialized}
              aria-label="账户菜单"
            >
              A
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => handleNavigate("settings")}>
              <Settings size={15} />
              <span>{t("settingsTab")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
