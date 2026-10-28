import { addDays, businessDateAt, MAX_FUTURE_SKEW_MS } from "@cemms/domain";
import { AppError } from "../../core/errors";
import type { TenantContext } from "../context";
import type { estates } from "../schema";
import { setting } from "./settings";

/** Hard limit on how old an offline capture may be when it reaches the server. */
export const MAX_CAPTURE_AGE_DAYS = 8;
/** How far back users holding a .correct permission may enter a missed day. */
export const MANAGER_BACK_ENTRY_DAYS = 31;

/**
 * The business date must match the device's local date at capture time, or be up to
 * `attendance.backEntryDays` earlier (OC-86 open, default 0). Managers may enter missed
 * days further back. Clock skew into the future is refused.
 */
export function checkCaptureDate(
  ctx: TenantContext,
  estate: typeof estates.$inferSelect,
  businessDate: string,
  capturedAt: string,
  managerPermission: "attendance.correct" | "muster.correct" | "dailylog.correct",
): void {
  const captured = new Date(capturedAt);
  const now = ctx.clock();
  if (Number.isNaN(captured.getTime())) throw new AppError(422, "CAPTURED_AT_INVALID", "Capture time is not valid");
  if (captured.getTime() - now.getTime() > MAX_FUTURE_SKEW_MS) throw new AppError(422, "CLOCK_AHEAD", "This phone's clock is ahead. Set the correct time and try again.");
  if (now.getTime() - captured.getTime() > MAX_CAPTURE_AGE_DAYS * 86_400_000) throw new AppError(422, "CAPTURE_TOO_OLD", "This entry is too old to sync. Ask a manager to enter it.");
  const deviceDate = businessDateAt(captured, estate.timeZone);
  const back = ctx.can(managerPermission, estate.id) ? MANAGER_BACK_ENTRY_DAYS : setting(ctx.db, "attendance.backEntryDays");
  if (businessDate > deviceDate) throw new AppError(422, "DATE_IN_FUTURE", "The date is in the future", { businessDate: "Future date" });
  if (businessDate < addDays(deviceDate, -back)) throw new AppError(422, "DATE_NOT_ALLOWED", "Entries for this date need a manager", { businessDate: "Too far back" });
}
