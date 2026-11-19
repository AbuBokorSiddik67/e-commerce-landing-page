import Link from "next/link";
import { RequestResetForm } from "@/components/forms/AuthForms";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-2 text-sm text-ink-500">We will send a single-use link to your account email when mail is configured.</p>
      <div className="mt-8"><RequestResetForm /></div>
      <p className="mt-8 text-sm"><Link href="/login" className="font-semibold text-brand-700 hover:underline">Back to login</Link></p>
    </div>
  );
}
