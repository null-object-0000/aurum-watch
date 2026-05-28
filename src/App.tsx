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

// ─── Constants ────────────────────────────────────────────────────────────

const RANGE_DURATION: Record<TimeRange, number> = {
  "1H": 60, "4H": 300, "1D": 900, "7D": 3600, "30D": 14400
};

export interface InitStatus {
  initialized: boolean;
  historyDays: number;
  historyMinutesCount: number;
  quotesCount: number;
  eventsCount: number;
  oandaConfigured: boolean;
  au9999Configured: boolean;
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
      fetch("/api/dashboard")
        .then((r) => r.json())
        .then(setData)
        .catch(console.error);
    }
  }, [route]);

  React.useEffect(() => {
    if (!data) return;
    fetch(`/api/candles?range=${range}`)
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
          setData((prev) => {
            if (!prev) return null;
            const quotes = message.payload.quotes;
            const xauQuote = quotes.find((q: any) => q.symbol === "XAU_USD");
            const auQuote  = quotes.find((q: any) => q.symbol === "AU9999");
            const latestXau = xauQuote?.value ?? null;
            const latestAu  = auQuote?.value  ?? null;
            const latestSentiment = message.payload.sentiment?.score ?? 0;

            const activeRange = rangeRef.current;
            const duration = RANGE_DURATION[activeRange];
            const time = new Date(message.payload.updatedAt || Date.now()).getTime() / 1000;
            const candleTimeSec = Math.floor(time / duration) * duration;
            const candleTimeISO = new Date(candleTimeSec * 1000).toISOString();

            let updatedCandles = prev.candles;
            const last = prev.candles[prev.candles.length - 1];

            if (last) {
              const lastSec = Math.floor(new Date(last.time).getTime() / 1000);
              if (candleTimeSec === lastSec) {
                updatedCandles = [...prev.candles.slice(0, -1),
                  { ...last, xauUsd: latestXau ?? last.xauUsd, au9999: latestAu ?? last.au9999, sentiment: latestSentiment }];
              } else if (candleTimeSec > lastSec) {
                const count = { "1H": 60, "4H": 48, "1D": 96, "7D": 168, "30D": 180 }[activeRange];
                updatedCandles = [...prev.candles,
                  { time: candleTimeISO, xauUsd: latestXau, au9999: latestAu, sentiment: latestSentiment }
                ].slice(-count);
              } else {
                updatedCandles = [...prev.candles.slice(0, -1),
                  { ...last, xauUsd: latestXau ?? last.xauUsd, au9999: latestAu ?? last.au9999, sentiment: latestSentiment }];
              }
            } else {
              updatedCandles = [{ time: candleTimeISO, xauUsd: latestXau, au9999: latestAu, sentiment: latestSentiment }];
            }

            return {
              ...prev,
              quotes: message.payload.quotes,
              candles: updatedCandles,
              sentiment: message.payload.sentiment,
              sources: message.payload.sources,
              updatedAt: message.payload.updatedAt
            };
          });
        }
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };
    return () => eventSource.close();
  }, []);

  // ── Navigation ────────────────────────────────────────────────────────
  function handleTabChange(to: "dashboard" | "settings") {
    navigateTo(to);
    setRoute(to);
  }

  const handleInitDone = React.useCallback(() => {
    setInitStatus((prev) => prev ? { ...prev, initialized: true } : null);
    setRoute("dashboard");
    navigateTo("dashboard");
    fetch("/api/dashboard").then((r) => r.json()).then(setData).catch(console.error);
  }, []);

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
