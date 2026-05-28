import React from "react";
import type { DashboardPayload, TimeRange } from "./types";
import { Dashboard } from "./components/Dashboard";
import { Topbar } from "./components/Topbar";

const RANGE_DURATION: Record<TimeRange, number> = {
  "1H": 60,
  "4H": 300,
  "1D": 900,
  "7D": 3600,
  "30D": 14400
};

export function App() {
  const [data, setData] = React.useState<DashboardPayload | null>(null);
  const [range, setRange] = React.useState<TimeRange>("1D");
  const rangeRef = React.useRef(range);

  React.useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  React.useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then(setData)
      .catch(console.error);
  }, []);

  React.useEffect(() => {
    if (!data) return;
    fetch(`/api/candles?range=${range}`)
      .then((res) => res.json())
      .then((candles) => {
        setData((prev) => (prev ? { ...prev, candles } : null));
      })
      .catch(console.error);
  }, [range, !data]);

  React.useEffect(() => {
    const eventSource = new EventSource("/api/stream");
    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "dashboard") {
          setData(message.payload);
        } else if (message.type === "update") {
          setData((prev) => {
            if (!prev) return null;

            const quotes = message.payload.quotes;
            const xauQuote = quotes.find((q: any) => q.symbol === "XAU_USD");
            const auQuote = quotes.find((q: any) => q.symbol === "AU9999");
            const latestXau = xauQuote?.value ?? null;
            const latestAu = auQuote?.value ?? null;
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
                updatedCandles = [
                  ...prev.candles.slice(0, -1),
                  {
                    ...last,
                    xauUsd: latestXau ?? last.xauUsd,
                    au9999: latestAu ?? last.au9999,
                    sentiment: latestSentiment
                  }
                ];
              } else if (candleTimeSec > lastSec) {
                const newCandle = {
                  time: candleTimeISO,
                  xauUsd: latestXau,
                  au9999: latestAu,
                  sentiment: latestSentiment
                };
                const count = activeRange === "1H" ? 60 : activeRange === "4H" ? 48 : activeRange === "1D" ? 96 : activeRange === "7D" ? 168 : 180;
                updatedCandles = [...prev.candles, newCandle].slice(-count);
              } else {
                updatedCandles = [
                  ...prev.candles.slice(0, -1),
                  {
                    ...last,
                    xauUsd: latestXau ?? last.xauUsd,
                    au9999: latestAu ?? last.au9999,
                    sentiment: latestSentiment
                  }
                ];
              }
            } else {
              updatedCandles = [
                {
                  time: candleTimeISO,
                  xauUsd: latestXau,
                  au9999: latestAu,
                  sentiment: latestSentiment
                }
              ];
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
        console.error("Failed to parse SSE message:", err);
      }
    };
    return () => eventSource.close();
  }, []);

  return (
    <div className="shell">
      <Topbar data={data} />
      <main className="main">
        <Dashboard data={data} range={range} onRangeChange={setRange} />
      </main>
    </div>
  );
}
