import type { PropsWithChildren } from "react";
import { Button } from "@/components/ui/button";

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
        {action && <Button variant="ghost" size="sm">{action}</Button>}
      </header>
      {children}
    </section>
  );
}
