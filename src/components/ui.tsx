import { useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<Variant, string> = {
  primary: "bg-indigo-500 hover:bg-indigo-400 text-white",
  secondary: "bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700",
  ghost: "bg-transparent hover:bg-neutral-800 text-neutral-200",
  danger: "bg-rose-600 hover:bg-rose-500 text-white",
};

export function Button({
  variant = "primary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClass[variant]} ${className}`}
    />
  );
}

export function Card({
  title,
  actions,
  children,
  className = "",
  collapsible = false,
  defaultOpen = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const showHeader = title || actions;

  return (
    <section
      className={`rounded-lg border border-neutral-800 bg-neutral-900/60 ${className}`}
    >
      {showHeader && (
        <header
          className={`flex items-center justify-between px-4 py-3 ${
            open ? "border-b border-neutral-800" : ""
          }`}
        >
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex flex-1 items-center gap-2 text-left text-sm font-semibold text-neutral-200"
            >
              <Chevron open={open} />
              <span>{title}</span>
            </button>
          ) : (
            <h2 className="text-sm font-semibold text-neutral-200">{title}</h2>
          )}
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      {(!collapsible || open) && <div className="p-4">{children}</div>}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-4 w-4 text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M7 5l6 5-6 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-indigo-500" : "bg-neutral-700"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
      <span className="flex flex-col">
        <span className="text-sm text-neutral-100">{label}</span>
        {hint && <span className="text-xs text-neutral-400">{hint}</span>}
      </span>
    </label>
  );
}

export function Select({
  className = "",
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={`w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none ${className}`}
    />
  );
}

export function TextInput({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        on ? "bg-emerald-400 shadow-[0_0_8px_theme(colors.emerald.400)]" : "bg-neutral-600"
      }`}
    />
  );
}
