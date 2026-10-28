import { ROLES } from "@cemms/domain";
import { z } from "zod";
import { id } from "./common";

export const loginRequest = z.object({
  /** Not needed on a tenant's own site address (the address decides the tenant). */
  tenant: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, "Enter your estate group code")
    .optional(),
  username: z.string().trim().toLowerCase().min(2).max(60),
  password: z.string().min(1).max(200),
  deviceId: id,
  deviceLabel: z.string().trim().max(80).optional(),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const grant = z.object({ role: z.enum(ROLES), estateId: id.nullable() });

export const sessionResponse = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
  sessionExpiresAt: z.string(),
  user: z.object({
    id,
    username: z.string(),
    displayName: z.string(),
    tenantId: id,
    tenantName: z.string(),
    grants: z.array(grant),
    /** True after an account is created or its password is reset: the app asks for a new password first. */
    mustChangePassword: z.boolean(),
  }),
});
export type SessionResponse = z.infer<typeof sessionResponse>;

export const mfaChallenge = z.object({
  mfa: z.enum(["required", "enrol"]),
  /** Present when enrolling: the base32 secret and otpauth URI to add to an authenticator app. */
  secret: z.string().optional(),
  otpauthUri: z.string().optional(),
});

export const passwordChange = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(12, "Use at least 12 characters").max(200) })
  .refine((v) => v.newPassword !== v.currentPassword, { message: "Choose a password different from the current one", path: ["newPassword"] });

/** An owner sets a temporary password for someone; they must change it at next sign-in. */
export const passwordReset = z.object({ password: z.string().min(12, "Use at least 12 characters").max(200) });

/** Change a person's name and what they may do; their sessions end so the new access applies at once. */
export const userUpdate = z.object({
  displayName: z.string().trim().min(1).max(120),
  grants: z.array(grant).min(1).max(20),
});

export const userCreate = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,60}$/),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(12, "Use at least 12 characters").max(200),
  grants: z.array(grant).min(1).max(20),
});
