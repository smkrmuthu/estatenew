import type { ReactNode } from "react";

// Line icons shared with the prototype's visual language (24px grid, 1.7 stroke).
const PATHS: Record<string, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18.5 14.8c1.7.8 2.8 2.6 3 5.2" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15Z" />
      <path d="M5 19 13 11" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v16" />
      <path d="M7 20h10" />
      <path d="M5 7h14" />
      <path d="m5 7-3 6.5a3 3 0 0 0 6 0Z" />
      <path d="m19 7-3 6.5a3 3 0 0 0 6 0Z" />
    </>
  ),
  cloud: (
    <>
      <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5 3.75 3.75 0 0 1 17.5 18Z" />
    </>
  ),
  chart: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M7 16.5v-5" />
      <path d="M12 16.5v-10" />
      <path d="M17 16.5v-7" />
    </>
  ),
  sync: (
    <>
      <path d="M20 12a8 8 0 0 1-14 5.3" />
      <path d="M4 12a8 8 0 0 1 14-5.3" />
      <path d="M18 3v3.7h-3.7" />
      <path d="M6 21v-3.7h3.7" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h4" />
      <path d="M12 17h8" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 2.5 20h19Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.3" r=".9" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.3 2.3 2.3 4.7-5" />
    </>
  ),
};

export type IconName = "grid" | "users" | "leaf" | "scale" | "cloud" | "chart" | "sync" | "sliders" | "clock" | "alert" | "check";

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
