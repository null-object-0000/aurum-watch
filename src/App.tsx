import React from "react";
import type { DashboardPayload } from "./types";
import { Dashboard } from "./components/Dashboard";
import { Topbar } from "./components/Topbar";

export function App() {
  const [data, setData] = React.useState<DashboardPayload | null>(null);

  React.useEffect(() => {
    fetch("/api/dashboard").then((res) => res.json()).then(setData).catch(console.error);
    const eventSource = new EventSource("/api/stream");
    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { type: string; payload: DashboardPayload };
        if (message.type === "dashboard") setData(message.payload);
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
        <Dashboard data={data} />
      </main>
    </div>
  );
}
