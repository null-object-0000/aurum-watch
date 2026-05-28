import type { PropsWithChildren } from "react";

interface PanelProps {
  title: string;
  hint?: string;
  action?: string;
  className?: string;
}

export function Panel({ title, hint, action, className = "", children }: PropsWithChildren<PanelProps>) {
  return (
    <section className={`panel ${className}`}>
      <header>
        <h2>{title} {hint && <span>{hint}</span>}</h2>
        {action && <button>{action}</button>}
      </header>
      {children}
    </section>
  );
}
