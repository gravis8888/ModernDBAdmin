import type { PropsWithChildren } from "react";

import { cn } from "@/lib/cn";

type BadgeProps = PropsWithChildren<{
  tone?: "default" | "success" | "warning" | "danger" | "muted" | "outline";
  className?: string;
}>;

const tones = {
  default: "bg-[var(--panel-soft)] text-[var(--foreground)]",
  success: "bg-[var(--success-soft)] text-[var(--success)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
  muted: "bg-[var(--panel-soft)] text-[var(--muted-strong)]",
  outline: "border border-[var(--border)] bg-transparent text-[var(--muted-strong)]",
};

export function Badge({ children, className, tone = "default" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
