import React from "react";
import { formatClock } from "../utils/format";
import type { DashboardPayload } from "../types";

interface TopbarProps {
  data: DashboardPayload | null;
}

export function Topbar({ data }: TopbarProps) {
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <img src="/icon.svg" alt="" />
        <div>
          <strong>金哨 Aurum Watch</strong>
          <span>舆情洞察 · 影响预测</span>
        </div>
      </div>
      <div className="topbar-right">
        <b className={data ? "dot ok" : "dot error"} />
        <strong>{formatClock(now)}</strong>
        <span className="avatar">A</span>
      </div>
    </header>
  );
}
