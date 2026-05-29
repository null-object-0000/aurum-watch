import React from "react";
import { BarChart3, Database, Languages, ListChecks, Menu, Monitor, Moon, Settings, Sun, X } from "lucide-react";
import { formatClock } from "../utils/format";
import type { DashboardPayload } from "../types";
import { usePreferences, type LanguagePreference, type ThemePreference } from "../preferences";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

  const themeIcon = preferences.theme === "dark"
    ? <Moon size={15} />
    : preferences.theme === "light"
      ? <Sun size={15} />
      : <Monitor size={15} />;

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
        <div className="topbar-select-control" title={t("theme")}>
          <span className="topbar-select-icon">{themeIcon}</span>
          <Select
            value={preferences.theme}
            onValueChange={(value) => preferences.setTheme(value as ThemePreference)}
          >
            <SelectTrigger aria-label={t("theme")} className="h-8 w-auto min-w-[78px] border-0 bg-transparent px-1 shadow-none focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("system")}</SelectItem>
              <SelectItem value="dark">{t("dark")}</SelectItem>
              <SelectItem value="light">{t("light")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="topbar-select-control" title={t("language")}>
          <span className="topbar-select-icon"><Languages size={15} /></span>
          <Select
            value={preferences.language}
            onValueChange={(value) => preferences.setLanguage(value as LanguagePreference)}
          >
            <SelectTrigger aria-label={t("language")} className="h-8 w-auto min-w-[78px] border-0 bg-transparent px-1 shadow-none focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("system")}</SelectItem>
              <SelectItem value="zh-CN">{t("zh-CN")}</SelectItem>
              <SelectItem value="en-US">{t("en-US")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
