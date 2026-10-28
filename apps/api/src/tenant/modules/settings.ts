import { checkSettingChange, type GateStatus, isSettingKey, resolveSetting, SETTING_DEFS, SettingError, type SettingKey } from "@cemms/domain";
import { eq } from "drizzle-orm";
import register from "../../../../../docs/owner-confirmations.json";
import { AppError } from "../../core/errors";
import type { Db, TenantContext } from "../context";
import { gateConfirmations, settings } from "../schema";

export function storedSettings(db: Db): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of db.select().from(settings).all()) out[row.key] = JSON.parse(row.valueJson);
  return out;
}

export function setting<K extends SettingKey>(db: Db, key: K) {
  return resolveSetting(key, storedSettings(db));
}

export function gateStatusOf(db: Db): (id: string) => GateStatus {
  const map = new Map(
    db
      .select()
      .from(gateConfirmations)
      .all()
      .map((g) => [g.gateId, g.status]),
  );
  return (id) => map.get(id) ?? "open";
}

export function listSettings(ctx: TenantContext) {
  ctx.requireAny("estate.read");
  const stored = storedSettings(ctx.db);
  const status = gateStatusOf(ctx.db);
  return Object.values(SETTING_DEFS).map((def) => ({
    key: def.key,
    description: def.description,
    value: resolveSetting(def.key as SettingKey, stored),
    isDefault: !Object.hasOwn(stored, def.key),
    basis: def.basis,
    gates: def.gates.map((g) => ({ id: g, status: status(g) })),
  }));
}

export function changeSetting(ctx: TenantContext, key: string, value: unknown) {
  ctx.requireAny("settings.configure");
  if (!isSettingKey(key)) throw new AppError(404, "SETTING_UNKNOWN", "Unknown setting");
  try {
    checkSettingChange(key, value, ctx.scope.environment, gateStatusOf(ctx.db));
  } catch (e) {
    if (e instanceof SettingError) throw new AppError(e.code === "GATE_NOT_CONFIRMED" ? 409 : 422, e.code, e.message);
    throw e;
  }
  return ctx.tx((db) => {
    const before = db.select().from(settings).where(eq(settings.key, key)).get();
    const next = { key, valueJson: JSON.stringify(value), basis: SETTING_DEFS[key].basis, version: (before?.version ?? 0) + 1, updatedAt: ctx.nowIso(), updatedBy: ctx.scope.userId };
    db.insert(settings).values(next).onConflictDoUpdate({ target: settings.key, set: next }).run();
    ctx.audit(db, { action: "setting.change", entityType: "setting", entityId: key, estateId: null, before: before ? JSON.parse(before.valueJson) : null, after: value });
    return { key, value, version: next.version };
  });
}

type RegisterItem = (typeof register.items)[number];

/** Gates as recorded for this tenant, joined with the question text from the register. */
export function listGates(ctx: TenantContext) {
  ctx.require("estate.read", null);
  const rows = new Map(
    ctx.db
      .select()
      .from(gateConfirmations)
      .all()
      .map((g) => [g.gateId, g]),
  );
  return register.items.map((item: RegisterItem) => {
    const row = rows.get(item.id);
    return {
      id: item.id,
      question: item.question,
      phase: item.phase,
      blocksProduction: Boolean(item.blocksProductionActivation),
      interimBehavior: item.interimBehavior,
      status: row?.status ?? "open",
      answer: row?.answer ?? null,
      approver: row?.approver ?? null,
      decidedOn: row?.decidedOn ?? null,
    };
  });
}

export function recordGate(ctx: TenantContext, gateId: string, input: { status: GateStatus; answer: string; approver: string; decidedOn: string; source: string }) {
  ctx.require("settings.manage", null);
  if (!register.items.some((i: RegisterItem) => i.id === gateId)) throw new AppError(404, "GATE_UNKNOWN", "Unknown question");
  return ctx.tx((db) => {
    const before = db.select().from(gateConfirmations).where(eq(gateConfirmations.gateId, gateId)).get();
    const next = { gateId, ...input, updatedAt: ctx.nowIso(), updatedBy: ctx.scope.userId };
    db.insert(gateConfirmations).values(next).onConflictDoUpdate({ target: gateConfirmations.gateId, set: next }).run();
    ctx.audit(db, { action: "gate.record", entityType: "gate", entityId: gateId, estateId: null, before: before ?? null, after: next });
    return next;
  });
}

/** Seed confirmed answers from the register (first tenant only, at provisioning). */
export function seedGatesFromRegister(db: Db, actor: string, now: string): number {
  let n = 0;
  for (const item of register.items as RegisterItem[]) {
    if (item.status !== "confirmed" && item.status !== "answered-unclear") continue;
    db.insert(gateConfirmations)
      .values({
        gateId: item.id,
        status: item.status as GateStatus,
        answer: item.ownerAnswer ?? null,
        approver: item.approver ?? null,
        decidedOn: item.decidedOn ?? null,
        source: item.source,
        updatedAt: now,
        updatedBy: actor,
      })
      .onConflictDoNothing()
      .run();
    n++;
  }
  return n;
}

/** Open questions that block production for the behaviour this tenant uses. */
export function readiness(ctx: TenantContext) {
  ctx.require("settings.manage", null);
  const gates = listGates(ctx);
  const blocking = gates.filter((g) => g.blocksProduction && g.status !== "confirmed" && (g.phase === "1A" || g.phase === "0"));
  return { phase: "1A", ready: blocking.length === 0, blocking };
}
