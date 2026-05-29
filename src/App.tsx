import React from "react";
import type { DashboardPayload, TimeRange } from "./types";
import { Dashboard } from "./pages/Dashboard";
import { Topbar, type AppRoute } from "./components/Topbar";
import { InitPortal } from "./components/InitPortal";
import { DataManagement } from "./pages/DataManagement";
import { Tasks } from "./pages/Tasks";
import { Settings } from "./pages/Settings";

const DASHBOARD_SSE_REFRESH_THROTTLE_MS = 1000;

// ─── Hash Router ──────────────────────────────────────────────────────────

type Route = AppRoute | "init";

function getRouteFromHash(): AppRoute {
  const path = window.location.hash.replace(/^#\/?/, "");
  if (path === "data" || path === "tasks" || path === "settings") return path;
  return "dashboard";
}

function navigateTo(to: AppRoute) {
  window.location.hash = to === "dashboard" ? "#/" : `#/${to}`;
}

export interface InitStatus {
  initialized: boolean;
  historyDays: number;
  historyMinutesCount: number;
  quotesCount: number;
  eventsCount: number;
  oandaConfigured: boolean;
  au9999Configured: boolean;
  au9999Reachable?: boolean;
  aktoolsVersion?: string | null;
  aktoolsError?: string | null;
  dbSizeBytes: number;
}

// ─── App ──────────────────────────────────────────────────────────────────

export function App() {
  const [data, setData] = React.useState<DashboardPayload | null>(null);
  const [range, setRange] = React.useState<TimeRange>("1D");
  const rangeRef = React.useRef(range);
  const [route, setRoute] = React.useState<Route>("init");
  const [initStatus, setInitStatus] = React.useState<InitStatus | null>(null);

  React.useEffect(() => { rangeRef.current = range; }, [range]);

  const loadDashboard = React.useCallback(async () => {
    const tzOffset = new Date().getTimezoneOffset();
    const dashboard = await fetch("/api/dashboard").then((r) => r.json());
    const candles = await fetch(`/api/candles?range=${rangeRef.current}&tzOffset=${tzOffset}`).then((r) => r.json());
    setData({ ...dashboard, candles });
  }, []);

  // ── Hash routing ──────────────────────────────────────────────────────
  React.useEffect(() => {
    function onHashChange() {
      if (initStatus?.initialized) {
        setRoute(getRouteFromHash());
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [initStatus?.initialized]);

  // ── Initialization check ──────────────────────────────────────────────
  React.useEffect(() => {
    fetch("/api/init-status")
      .then((r) => r.json())
      .then((status: InitStatus) => {
        setInitStatus(status);
        if (status.initialized) {
          setRoute(getRouteFromHash());
        } else {
          setRoute("init");
          window.location.hash = "#/";
        }
      })
      .catch(() => setRoute("dashboard"));
  }, []);

  React.useEffect(() => {
    if (route !== "dashboard") return;

    let eventSource: EventSource | null = null;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastRefreshAt = 0;

    const stopSse = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const scheduleRefresh = () => {
      if (document.hidden || refreshTimeout) return;
      const waitMs = Math.max(0, DASHBOARD_SSE_REFRESH_THROTTLE_MS - (Date.now() - lastRefreshAt));
      refreshTimeout = setTimeout(() => {
        refreshTimeout = null;
        lastRefreshAt = Date.now();
        loadDashboard().catch(console.error);
      }, waitMs);
    };

    const startSse = () => {
      if (eventSource || document.hidden) return;
      eventSource = new EventSource("/api/stream");
      eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "update") scheduleRefresh();
        } catch (err) {
          console.error("SSE parse error:", err);
        }
      };
      eventSource.onerror = stopSse;
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopSse();
        if (refreshTimeout) {
          clearTimeout(refreshTimeout);
          refreshTimeout = null;
        }
      } else {
        loadDashboard().catch(console.error);
        startSse();
      }
    };

    loadDashboard().catch(console.error);
    startSse();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopSse();
      if (refreshTimeout) clearTimeout(refreshTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [route, loadDashboard]);

  React.useEffect(() => {
    if (!data) return;
    const tzOffset = new Date().getTimezoneOffset();
    fetch(`/api/candles?range=${range}&tzOffset=${tzOffset}`)
      .then((r) => r.json())
      .then((candles) => setData((prev) => (prev ? { ...prev, candles } : null)))
      .catch(console.error);
  }, [range, !data]);

  // ── Navigation ────────────────────────────────────────────────────────
  function handleTabChange(to: AppRoute) {
    navigateTo(to);
    setRoute(to);
  }

  const handleInitDone = React.useCallback(() => {
    setInitStatus((prev) => prev ? { ...prev, initialized: true } : null);
    setRoute("dashboard");
    navigateTo("dashboard");
    loadDashboard().catch(console.error);
  }, [loadDashboard]);

  const refreshInitStatus = React.useCallback(() => {
    fetch("/api/init-status")
      .then((r) => r.json())
      .then((status: InitStatus) => setInitStatus(status))
      .catch(console.error);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────
  if (route === "init" && initStatus) {
    return <InitPortal status={initStatus} onDone={handleInitDone} onStatusRefresh={refreshInitStatus} />;
  }

  return (
    <div className="shell">
      <Topbar
        data={data}
        activeTab={route}
        initialized={initStatus?.initialized ?? false}
        onTabChange={handleTabChange}
      />
      <main className="main">
        {route === "data" && <DataManagement />}
        {route === "tasks" && <Tasks />}
        {route === "settings" && <Settings />}
        {route === "dashboard" && <Dashboard data={data} range={range} onRangeChange={setRange} />}
      </main>
    </div>
  );
}
