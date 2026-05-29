import type { PropsWithChildren, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface PanelProps {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function Panel({ title, hint, action, className = "", children }: PropsWithChildren<PanelProps>) {
  return (
    <section className={`panel ${className}`}>
      <header>
        <h2>{title} {hint && <span>{hint}</span>}</h2>
        {action && (
          typeof action === "string" ? (
            <Button variant="ghost" size="sm">{action}</Button>
          ) : (
            action
          )
        )}
      </header>
      {children}
    </section>
  );
}
