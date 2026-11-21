import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/forms/AuthForms";
import { logoutAction } from "@/app/actions/auth";

export const metadata = { title: "Change password" };
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Change your password</h1>
      <p className="mt-2 text-sm text-ink-500">{user.mustResetPassword
        ? "Set a private password before using the dashboard."
        : "Choose a new password; other sessions and unused reset links will be revoked."}</p>
      <div className="mt-8"><ChangePasswordForm /></div>
      <form action={logoutAction} className="mt-6"><button className="text-sm font-semibold text-brand-700 underline">Sign out</button></form>
    </div>
  );
}
