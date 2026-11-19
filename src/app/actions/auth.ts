"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { login, logout, createPasswordResetToken, consumePasswordResetToken, changePassword, requireUser } from "@/lib/auth";
import { emailSchema, passwordSchema } from "@/lib/validation";
import { toErrorMessage } from "@/lib/errors";

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1) });

export async function loginAction(_state: { error?: string } | undefined, formData: FormData) {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password" };
  try {
    await login(parsed.data.email, parsed.data.password);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  redirect("/dashboard");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function requestResetAction(_state: { error?: string; message?: string } | undefined, formData: FormData) {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address" };
  const token = await createPasswordResetToken(parsed.data);
  if (token) {
    const { sendTransactionalEmail } = await import("@/lib/notifications");
    const link = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/reset-password?token=${token}`;
    await sendTransactionalEmail(parsed.data, "Reset your LANDIQ password", `Use this link within one hour: ${link}`);
  }
  if (process.env.NODE_ENV !== "production" && token) {
    return { message: `Development only: reset link /reset-password?token=${token}` };
  }
  return { message: "If that account exists, a reset link has been sent." };
}

export async function resetPasswordAction(_state: { error?: string; message?: string } | undefined, formData: FormData) {
  const schema = z.object({ token: z.string().min(10), password: passwordSchema });
  const parsed = schema.safeParse({ token: formData.get("token"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid reset request" };
  try {
    await consumePasswordResetToken(parsed.data.token, parsed.data.password);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  redirect("/login?success=password-reset");
}

export async function changePasswordAction(_state: { error?: string; message?: string } | undefined, formData: FormData) {
  const schema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });
  const parsed = schema.safeParse({ currentPassword: formData.get("currentPassword"), newPassword: formData.get("newPassword") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid password" };
  const user = await requireUser();
  try {
    await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  return { message: "Password updated" };
}
