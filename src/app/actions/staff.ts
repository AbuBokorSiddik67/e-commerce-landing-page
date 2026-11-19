"use server";
import bcrypt from "bcryptjs";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { emailSchema, nameSchema, passwordSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { finish, str } from "./helpers";

export async function createStaffAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.STAFF_WRITE);
  await finish("/dashboard/staff", async () => {
    const email = emailSchema.parse(str(formData, "email").toLowerCase());
    const name = nameSchema.parse(str(formData, "name"));
    const password = passwordSchema.parse(str(formData, "password"));
    const roleIds = formData.getAll("roleIds").map(String).filter(Boolean);
    if (!roleIds.length) throw new Error("Choose at least one role");
    if (roleIds.includes("OWNER")) throw new Error("Owner role cannot be assigned here");
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new Error("A staff account with this email already exists");
    const staff = await prisma.user.create({
      data: { name, email, passwordHash: await bcrypt.hash(password, 12), roles: { create: roleIds.map((roleId) => ({ roleId })) } },
    });
    await audit({ actorId: user.id, action: "CREATE_STAFF", entity: "User", entityId: staff.id, after: { email, roleIds } as never });
  }, "Staff account created");
}

export async function updateStaffRolesAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.STAFF_WRITE);
  await finish("/dashboard/staff", async () => {
    const id = str(formData, "id");
    const roleIds = formData.getAll("roleIds").map(String).filter(Boolean).filter((r) => r !== "OWNER");
    if (!roleIds.length) throw new Error("Choose at least one role");
    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: id, role: { key: { not: "OWNER" } } } }),
      prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })), skipDuplicates: true }),
    ]);
    await prisma.user.update({ where: { id }, data: { isActive: str(formData, "isActive") === "on" } });
    await audit({ actorId: user.id, action: "UPDATE_STAFF", entity: "User", entityId: id, after: { roleIds } as never });
  }, "Staff account updated");
}

export async function resetStaffPasswordAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.STAFF_WRITE);
  await finish("/dashboard/staff", async () => {
    const id = str(formData, "id");
    const password = passwordSchema.parse(str(formData, "password"));
    await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 12), mustResetPassword: true } });
    await prisma.session.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } });
    await audit({ actorId: user.id, action: "RESET_STAFF_PASSWORD", entity: "User", entityId: id });
  }, "Password reset and sessions revoked");
}
