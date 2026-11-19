import { ResetPasswordForm } from "@/components/forms/AuthForms";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-2 text-sm text-ink-500">Reset links expire after one hour and can be used once.</p>
      <div className="mt-8">{token ? <ResetPasswordForm token={token} /> : <div className="alert-error">Missing reset token.</div>}</div>
    </div>
  );
}
