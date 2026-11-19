import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/forms/AuthForms";

export const metadata = { title: "Owner login" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const params = await searchParams;
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-2 text-sm text-ink-500">Sign in to manage your installation.</p>
      {params.success === "password-reset" && <div className="alert-success mt-6">Password updated. Please sign in.</div>}
      <div className="mt-8"><LoginForm /></div>
      <p className="mt-8 text-xs text-ink-400">No public registration exists. Owner accounts are created during installation or by an administrator.</p>
    </div>
  );
}
