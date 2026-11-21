"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { login, logout, createPasswordResetToken, consumePasswordResetToken, changePassword, requireUser } from "@/lib/auth";
import { emailSchema, passwordSchema } from "@/lib/validation";
import { AppError, RateLimitError } from "@/lib/errors";
import { siteUrl } from "@/lib/config";

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1) });

export async function loginAction(_state: { error?: string } | undefined, formData: FormData) {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password" };
  try {
    await login(parsed.data.email, parsed.data.password);
  } catch (error) {
    return { error: error instanceof AppError ? error.message : "Unable to sign in. Please try again." };
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
  try {
    const token = await createPasswordResetToken(parsed.data);
    if (token) {
      const { sendTransactionalEmail } = await import("@/lib/notifications");
      const link = `${siteUrl()}/reset-password?token=${token}`;
      await sendTransactionalEmail(parsed.data, "Reset your LANDIQ password", `Use this link within one hour: ${link}`);
    }
    // A reset URL is an account-recovery capability. Showing it to whoever
    // submits an email enables account takeover on any exposed dev server, so
    // require an explicit opt-in and never allow it in production.
    if (process.env.NODE_ENV === "development" && process.env.LANDIQ_SHOW_DEV_RESET_LINK === "1" && token) {
      return { message: `Development only: reset link /reset-password?token=${token}` };
    }
  } catch (error) {
    if (error instanceof RateLimitError) return { error: "Too many reset requests. Please try again later." };
    // The public response must not reveal database or provider errors.
  }
  return { message: "If that account exists and email is configured, a reset link will be sent." };
}

export async function resetPasswordAction(_state: { error?: string; message?: string } | undefined, formData: FormData) {
  const schema = z.object({ token: z.string().min(10), password: passwordSchema });
  const parsed = schema.safeParse({ token: formData.get("token"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid reset request" };
  try {
    await consumePasswordResetToken(parsed.data.token, parsed.data.password);
  } catch (error) {
    return { error: error instanceof AppError ? error.message : "Unable to reset the password. Please try again." };
  }
  redirect("/login?success=password-reset");
}

export async function changePasswordAction(_state: { error?: string; message?: string } | undefined, formData: FormData) {
  const schema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });
  const parsed = schema.safeParse({ currentPassword: formData.get("currentPassword"), newPassword: formData.get("newPassword") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid password" };
  const user = await requireUser();
  try {
    await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword, user.sessionId);
  } catch (error) {
    return { error: error instanceof AppError ? error.message : "Unable to update the password. Please try again." };
  }
  return { message: "Password updated" };
}
