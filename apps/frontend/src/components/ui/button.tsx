import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

import { cn } from "@/lib/cn";

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
  }
>;

const variants = {
  primary:
    "border border-transparent bg-[var(--accent)] text-white shadow-[0_10px_24px_var(--shadow-color)] hover:bg-[var(--accent-strong)]",
  secondary:
    "border border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] shadow-[0_1px_0_rgba(255,255,255,0.08)_inset] hover:bg-[var(--panel-strong)]",
  ghost: "bg-transparent text-[var(--foreground)] hover:bg-[var(--panel-strong)]",
  danger:
    "bg-[var(--danger)] text-white shadow-[0_10px_24px_var(--danger-soft)] hover:brightness-110",
};

export function Button({
  children,
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
