"use server";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { emailSchema, nameSchema, passwordSchema } from "@/lib/validation";
import { bool, finish, str } from "./helpers";

function selectedRoles(formData: FormData) {
  const ids = [...new Set(formData.getAll("roleIds").map(String).filter(Boolean))];
  if (!ids.length) throw new Error("Choose at least one role");
  return ids;
}

async function validateAssignableRoles(tx: Prisma.TransactionClient, ids: string[]) {
  // Form values are database role IDs, not role keys. Never compare an ID to
  // the literal "OWNER" and assume that prevents a forged owner assignment.
  const roles = await tx.role.findMany({ where: { id: { in: ids } }, select: { id: true, key: true } });
  if (roles.length !== ids.length || roles.some((role) => role.key === "OWNER")) {
    throw new Error("One or more selected roles are invalid or cannot be assigned");
  }
}

async function lockNonOwner(tx: Prisma.TransactionClient, id: string) {
  // Serialize staff edits with one another and check the protected role on the
  // server, not just by hiding controls in the UI.
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
  if (!locked.length) throw new Error("Staff account not found");
  const owner = await tx.userRole.findFirst({ where: { userId: id, role: { key: "OWNER" } }, select: { userId: true } });
  if (owner) throw new Error("Owner accounts cannot be modified through staff management");
}

export async function createStaffAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.STAFF_WRITE);
  await finish("/dashboard/staff", async () => {
    const email = emailSchema.parse(str(formData, "email").toLowerCase());
    const name = nameSchema.parse(str(formData, "name"));
    const password = passwordSchema.parse(str(formData, "password"));
    const roleIds = selectedRoles(formData);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      await validateAssignableRoles(tx, roleIds);
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new Error("A staff account with this email already exists");
      const staff = await tx.user.create({
        data: { name, email, passwordHash, mustResetPassword: true, roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      });
      await tx.auditLog.create({ data: { actorId: user.id, action: "CREATE_STAFF", entity: "User", entityId: staff.id,
        after: { email, roleIds } } });
    });
  }, "Staff account created");
}

export async function updateStaffRolesAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.STAFF_WRITE);
  await finish("/dashboard/staff", async () => {
    const id = str(formData, "id");
    const roleIds = selectedRoles(formData);
    const isActive = bool(formData, "isActive");
    if (id === user.id && !isActive) throw new Error("You cannot disable your own account");
    await prisma.$transaction(async (tx) => {
      await lockNonOwner(tx, id);
      await validateAssignableRoles(tx, roleIds);
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
      await tx.user.update({ where: { id }, data: { isActive } });
      // Re-enabling a staff member must not revive old sessions or reset links.
      if (!isActive) {
        const now = new Date();
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
        await tx.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: now } });
      }
      await tx.auditLog.create({ data: { actorId: user.id, action: "UPDATE_STAFF", entity: "User", entityId: id,
        after: { roleIds, isActive } } });
    });
  }, "Staff account updated");
}

export async function resetStaffPasswordAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.STAFF_WRITE);
  await finish("/dashboard/staff", async () => {
    const id = str(formData, "id");
    const password = passwordSchema.parse(str(formData, "password"));
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      await lockNonOwner(tx, id);
      await tx.user.update({ where: { id }, data: { passwordHash, mustResetPassword: true } });
      const now = new Date();
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: now } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "RESET_STAFF_PASSWORD", entity: "User", entityId: id } });
    });
  }, "Password reset and sessions revoked");
}
