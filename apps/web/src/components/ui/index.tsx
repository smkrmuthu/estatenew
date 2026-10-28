// Small shadcn-style primitives (copied-in components, styled with Tailwind tokens).
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { LocalStatus } from "../../lib/db";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "md" | "lg" | "sm" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45",
        size === "lg" ? "min-h-14 px-5 text-lg" : size === "sm" ? "min-h-9 px-3 text-sm" : "min-h-12 px-4 pointer-fine:min-h-9 pointer-fine:text-[0.88rem]",
        variant === "primary" && "bg-roast text-roast-ink hover:opacity-90",
        variant === "secondary" && "border border-line-strong bg-surface text-ink hover:bg-surface-2",
        variant === "ghost" && "text-ink hover:bg-surface-2",
        variant === "danger" && "bg-bad text-white hover:opacity-90",
        className,
      )}
    />
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[0.8rem] font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-muted hover:border-muted pointer-fine:min-h-9 pointer-fine:text-[0.92rem]",
        props.className,
      )}
    />
  );
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        "min-h-12 w-full rounded-lg border border-line-strong bg-surface pl-3 pr-8 text-base text-ink hover:border-muted pointer-fine:min-h-9 pointer-fine:text-[0.92rem]",
        props.className,
      )}
    >
      {children}
    </select>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-surface p-4", className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

const STATUS_TEXT: Record<LocalStatus, string> = { waiting: "Waiting on this phone", accepted: "Saved on server", rejected: "Not accepted", conflict: "Needs a manager" };
const STATUS_SHORT: Record<LocalStatus, string> = { waiting: "Waiting", accepted: "Saved", rejected: "Not accepted", conflict: "Conflict" };

/** Sync state is always shown in words as well as colour. */
export function StatusBadge({ status, compact }: { status: LocalStatus; compact?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        status === "waiting" && "bg-waiting/15 text-waiting",
        status === "accepted" && "bg-ok/15 text-ok",
        status === "rejected" && "bg-bad/15 text-bad",
        status === "conflict" && "bg-warn/15 text-warn",
      )}
    >
      <span aria-hidden="true">{status === "accepted" ? "✓" : status === "waiting" ? "⏳" : "!"}</span>
      {compact ? STATUS_SHORT[status] : STATUS_TEXT[status]}
    </span>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cx(
        "rounded-lg border px-3 py-2 text-sm",
        tone === "info" && "border-line bg-bg text-ink",
        tone === "warn" && "border-warn/40 bg-warn/10 text-ink",
        tone === "bad" && "border-bad/40 bg-bad/10 text-ink",
        tone === "ok" && "border-ok/40 bg-ok/10 text-ink",
      )}
    >
      {children}
    </div>
  );
}
