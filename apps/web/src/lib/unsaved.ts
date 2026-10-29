import { useEffect, useId } from "react";

/** Screens with something typed but not saved yet. A new app version waits for these instead of reloading over them. */
const open = new Set<string>();

/** Mark this screen as holding unsaved typing while `active` is true. */
export function useUnsaved(active: boolean): void {
  const id = useId();
  useEffect(() => {
    if (active) open.add(id);
    return () => {
      open.delete(id);
    };
  }, [active, id]);
}

/** True when reloading now could lose something the person is in the middle of entering. */
export function hasUnsaved(): boolean {
  if (open.size > 0) return true;
  const el = document.activeElement;
  if (el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return true;
  return document.querySelector('[role="dialog"]') !== null;
}
