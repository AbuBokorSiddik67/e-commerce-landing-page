import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { hashToken, randomToken } from "./crypto";
import { checkRateLimit, resetRateLimit } from "./rate-limit";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { hasPermission, type PermissionKey } from "./permissions";
import { audit } from "./audit";

export const SESSION_COOKIE = "landiq_session";
const SESSION_DAYS = 30;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: Set<PermissionKey>;
  sessionId: string;
};

async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

export async function login(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const meta = await requestMeta();
  const key = `login:${normalized}:${meta.ip ?? "unknown"}`;
  checkRateLimit(key, 8, 15 * 60 * 1000);

  const user = await prisma.user.findUnique({ where: { email: normalized }, include: { roles: { include: { role: true } } } });
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !valid || !user.isActive) {
    await prisma.loginAttempt.create({
      data: { email: normalized, ip: meta.ip, success: false, reason: !user ? "unknown_user" : !valid ? "bad_password" : "inactive" },
    });
    throw new UnauthorizedError("Invalid email or password");
  }

  const token = randomToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
  await prisma.loginAttempt.create({ data: { email: normalized, ip: meta.ip, success: true } });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ actorId: user.id, action: "LOGIN", entity: "User", entityId: user.id, ip: meta.ip });
  resetRateLimit(key);

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return user.id;
}

export async function logout() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (session) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await audit({ actorId: session.userId, action: "LOGOUT", entity: "User", entityId: session.userId });
    }
  }
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { roles: { include: { role: true } } } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) return null;
  const roles = session.user.roles.map((r) => r.role.key);
  const { permissionsForRoles } = await import("./permissions");
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    roles,
    permissions: permissionsForRoles(roles),
    sessionId: session.id,
  };
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requirePermission(permission: PermissionKey) {
  const user = await requireUser();
  if (!user.permissions.has(permission)) throw new ForbiddenError();
  return user;
}

export async function requirePageAccess(permission: PermissionKey, mode: "redirect" | "throw" = "redirect") {
  const user = await getCurrentUser();
  if (!user) {
    if (mode === "redirect") redirect("/login");
    throw new UnauthorizedError();
  }
  if (!user.permissions.has(permission)) {
    if (mode === "redirect") redirect("/dashboard?error=forbidden");
    throw new ForbiddenError();
  }
  return user;
}

/** One-time password reset token; only its hash is persisted. */
export async function createPasswordResetToken(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.isActive) return null;
  const token = randomToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  await audit({ actorId: user.id, action: "PASSWORD_RESET_REQUESTED", entity: "User", entityId: user.id });
  return token;
}

export async function consumePasswordResetToken(token: string, newPassword: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) throw new Error("Invalid or expired reset link");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash, mustResetPassword: false } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.session.updateMany({ where: { userId: record.userId }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ action: "PASSWORD_RESET_COMPLETED", entity: "User", entityId: record.userId });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new Error("Current password is incorrect");
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 12), mustResetPassword: false },
  });
  await audit({ actorId: userId, action: "PASSWORD_CHANGED", entity: "User", entityId: userId });
}
