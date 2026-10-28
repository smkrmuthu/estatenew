// Small shadcn-style primitives (copied-in components, styled with Tailwind tokens).
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useEffect, useId, useRef } from "react";
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

/** Slide-over panel for forms, like the prototype's drawer. Escape and the scrim close it. */
export function Drawer({ title, subtitle, onClose, children }: { title: ReactNode; subtitle: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={String(subtitle)}
        className="relative flex h-full w-full max-w-xl flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-5 shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line pb-3">
          <div>
            <p className="text-[0.8rem] text-muted">{subtitle}</p>
            <h2 className="text-xl">{title}</h2>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Small status pill used in tables. */
export function Chip({ tone = "plain", children }: { tone?: "plain" | "ok" | "warn" | "bad" | "info"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "plain" && "bg-surface-2 text-muted",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "bad" && "bg-bad/15 text-bad",
        tone === "info" && "bg-info/15 text-info",
      )}
    >
      {children}
    </span>
  );
}

/** A row of headline figures, like the prototype's KPI strip. */
export function KpiStrip({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <div className="grid overflow-hidden rounded-2xl border border-line bg-surface sm:grid-cols-2 lg:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="flex min-w-0 flex-col gap-1 border-line p-4 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 sm:[&:not(:first-child)]:border-l">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{k.label}</span>
          <span className="text-2xl font-semibold tabular-nums leading-tight">{k.value}</span>
          {k.note && <span className="text-sm text-muted">{k.note}</span>}
        </div>
      ))}
    </div>
  );
}

/** A labelled drop-down used in a filter bar. */
export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <div className="flex min-w-32 flex-1 flex-col gap-1 sm:max-w-48">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** A labelled search box used in a filter bar. */
export function FilterSearch({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const id = useId();
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1 sm:max-w-56">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <Input id={id} type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** A row of filters with a count of what is shown and a way to clear them. */
export function FilterBar({ children, shown, total, noun, active, onClear }: { children: ReactNode; shown: number; total: number; noun: string; active: boolean; onClear: () => void }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-end gap-3 border-0 p-0">
      <legend className="sr-only">Filters</legend>
      {children}
      <div className="flex min-h-9 items-center gap-2 text-sm text-muted" aria-live="polite">
        <span>
          Showing {shown} of {total} {noun}
        </span>
        {active && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    </fieldset>
  );
}
