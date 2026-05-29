import React from "react";
import type { DashboardPayload, TimeRange } from "./types";
import { Dashboard } from "./components/Dashboard";
import { Topbar } from "./components/Topbar";
import { InitPortal } from "./components/InitPortal";
import { Settings } from "./components/Settings";

// ─── Hash Router ──────────────────────────────────────────────────────────

type Route = "dashboard" | "settings" | "init";

function getRouteFromHash(): "dashboard" | "settings" {
  return window.location.hash.startsWith("#/settings") ? "settings" : "dashboard";
}

function navigateTo(to: "dashboard" | "settings") {
  window.location.hash = to === "settings" ? "#/settings" : "#/";
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

  // ── Dashboard data ────────────────────────────────────────────────────
  React.useEffect(() => {
    if ((route === "dashboard") && !data) {
      loadDashboard().catch(console.error);
    }
  }, [route, data, loadDashboard]);

  React.useEffect(() => {
    if (!data) return;
    const tzOffset = new Date().getTimezoneOffset();
    fetch(`/api/candles?range=${range}&tzOffset=${tzOffset}`)
      .then((r) => r.json())
      .then((candles) => setData((prev) => (prev ? { ...prev, candles } : null)))
      .catch(console.error);
  }, [range, !data]);

  // ── SSE stream ────────────────────────────────────────────────────────
  React.useEffect(() => {
    const eventSource = new EventSource("/api/stream");
    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "update") {
          loadDashboard().catch(console.error);
        }
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };
    return () => eventSource.close();
  }, [loadDashboard]);

  // ── Navigation ────────────────────────────────────────────────────────
  function handleTabChange(to: "dashboard" | "settings") {
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
        activeTab={route as "dashboard" | "settings"}
        initialized={initStatus?.initialized ?? false}
        onTabChange={handleTabChange}
      />
      <main className="main">
        {route === "settings"
          ? <Settings />
          : <Dashboard data={data} range={range} onRangeChange={setRange} />
        }
      </main>
    </div>
  );
}
