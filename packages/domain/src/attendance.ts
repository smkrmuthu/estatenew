/** Attendance rules. Status vocabulary is configuration until OC-8 is confirmed. */

export type Presence = "PRESENT" | "ABSENT" | "LEAVE" | "OFF";
export type DayFraction = "FULL" | "HALF";

export interface AttendanceStatusDef {
  code: string;
  label: string;
  presence: Presence;
  /** Present statuses need Full day or Half day, a field and a job. */
  requiresAssignment: boolean;
  active: boolean;
  basis: "confirmed" | "proposed";
}

/**
 * Present and Absent with Full or Half day come from the process description the owner
 * accepted (OC-1). Leave, Off day and Holiday are listed in OC-8, which is unanswered.
 */
export const DEFAULT_ATTENDANCE_STATUSES: readonly AttendanceStatusDef[] = [
  { code: "PRESENT", label: "Present", presence: "PRESENT", requiresAssignment: true, active: true, basis: "confirmed" },
  { code: "ABSENT", label: "Absent", presence: "ABSENT", requiresAssignment: false, active: true, basis: "confirmed" },
  { code: "LEAVE", label: "Leave", presence: "LEAVE", requiresAssignment: false, active: false, basis: "proposed" },
  { code: "OFF_DAY", label: "Off day", presence: "OFF", requiresAssignment: false, active: false, basis: "proposed" },
  { code: "HOLIDAY", label: "Holiday", presence: "OFF", requiresAssignment: false, active: false, basis: "proposed" },
];

export type SheetState = "DRAFT" | "SUBMITTED" | "APPROVED";
export type SheetAction = "submit" | "approve" | "return";

const TRANSITIONS: Record<SheetAction, { from: SheetState; to: SheetState; reasonRequired: boolean }> = {
  submit: { from: "DRAFT", to: "SUBMITTED", reasonRequired: false },
  approve: { from: "SUBMITTED", to: "APPROVED", reasonRequired: false },
  return: { from: "SUBMITTED", to: "DRAFT", reasonRequired: true },
};

export class AttendanceRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export function transitionSheet(state: SheetState, action: SheetAction, reason?: string): SheetState {
  const t = TRANSITIONS[action];
  if (t.from !== state) {
    throw new AttendanceRuleError("SHEET_STATE", `This sheet is ${state.toLowerCase()} and cannot be ${action === "return" ? "returned" : `${action}ted`}`);
  }
  if (t.reasonRequired && !reason?.trim()) throw new AttendanceRuleError("REASON_REQUIRED", "Give a reason", "reason");
  return t.to;
}

/** Records in a sheet that is no longer a draft change only through a correction with a reason. */
export function editRequiresCorrection(state: SheetState): boolean {
  return state !== "DRAFT";
}

export interface AttendanceRecordInput {
  statusCode: string;
  dayFraction?: DayFraction | null;
  fieldId?: string | null;
  jobTypeId?: string | null;
  remarks?: string | null;
}

export interface NormalizedAttendanceRecord {
  statusCode: string;
  presence: Presence;
  dayFraction: DayFraction | null;
  fieldId: string | null;
  jobTypeId: string | null;
  remarks: string | null;
}

export function normalizeAttendanceRecord(input: AttendanceRecordInput, statuses: readonly AttendanceStatusDef[]): NormalizedAttendanceRecord {
  const def = statuses.find((s) => s.code === input.statusCode);
  if (!def?.active) throw new AttendanceRuleError("STATUS_NOT_ALLOWED", "This attendance type is not in use", "statusCode");
  const remarks = input.remarks?.trim() || null;
  if (remarks && remarks.length > 500) throw new AttendanceRuleError("REMARKS_TOO_LONG", "Remarks can be up to 500 characters", "remarks");
  if (!def.requiresAssignment) {
    return { statusCode: def.code, presence: def.presence, dayFraction: null, fieldId: null, jobTypeId: null, remarks };
  }
  if (input.dayFraction !== "FULL" && input.dayFraction !== "HALF") {
    throw new AttendanceRuleError("DAY_FRACTION_REQUIRED", "Choose full day or half day", "dayFraction");
  }
  if (!input.fieldId) throw new AttendanceRuleError("FIELD_REQUIRED", "Choose a field", "fieldId");
  if (!input.jobTypeId) throw new AttendanceRuleError("JOB_REQUIRED", "Choose a job", "jobTypeId");
  return { statusCode: def.code, presence: def.presence, dayFraction: input.dayFraction, fieldId: input.fieldId, jobTypeId: input.jobTypeId, remarks };
}

/** Man-days for summaries: a full day counts 2 halves, a half day 1 (integer halves avoid floats). */
export function halfDays(record: Pick<NormalizedAttendanceRecord, "presence" | "dayFraction">): number {
  if (record.presence !== "PRESENT") return 0;
  return record.dayFraction === "HALF" ? 1 : 2;
}
