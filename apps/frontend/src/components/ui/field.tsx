import type {
  InputHTMLAttributes,
  PropsWithChildren,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";

type FieldProps = PropsWithChildren<{
  label: string;
  hint?: string;
  className?: string;
}>;

export function Field({ children, className, hint, label }: FieldProps) {
  return (
    <label className={cn("block space-y-2", className)}>
      <span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-[var(--muted)]">{hint}</span> : null}
    </label>
  );
}

const inputClassName =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClassName, props.className)} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputClassName, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputClassName, "min-h-28 py-2.5", props.className)} />;
}

type CheckboxFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function CheckboxField({ hint, label, ...props }: CheckboxFieldProps) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-3 text-sm transition hover:border-[var(--border-strong)]">
      <input {...props} className="mt-0.5 size-4 accent-[var(--accent)]" type="checkbox" />
      <span className="space-y-1">
        <span className="block font-medium text-[var(--foreground)]">{label}</span>
        {hint ? <span className="block text-xs text-[var(--muted)]">{hint}</span> : null}
      </span>
    </label>
  );
}
