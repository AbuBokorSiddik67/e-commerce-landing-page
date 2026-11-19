"use client";
import { useActionState } from "react";
import Link from "next/link";
import { loginAction, requestResetAction, resetPasswordAction } from "@/app/actions/auth";
import { Button, Field } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <div className="alert-error" role="alert">{state.error}</div>}
      <Field label="Email address" name="email" required><input className="input" type="email" name="email" autoComplete="username" required /></Field>
      <Field label="Password" name="password" required><input className="input" type="password" name="password" autoComplete="current-password" required /></Field>
      <Button disabled={pending} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
      <p className="text-center text-sm text-ink-500"><Link href="/forgot-password" className="font-semibold text-brand-700 hover:underline">Forgot password?</Link></p>
    </form>
  );
}

export function RequestResetForm() {
  const [state, action, pending] = useActionState(requestResetAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <div className="alert-error">{state.error}</div>}
      {state?.message && <div className="alert-success">{state.message}</div>}
      <Field label="Email address" name="email" required><input className="input" type="email" name="email" required /></Field>
      <Button disabled={pending} className="w-full">{pending ? "Sending…" : "Send reset link"}</Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state?.error && <div className="alert-error">{state.error}</div>}
      <Field label="New password" name="password" required hint="At least 10 characters"><input className="input" type="password" name="password" minLength={10} required /></Field>
      <Button disabled={pending} className="w-full">{pending ? "Saving…" : "Set new password"}</Button>
    </form>
  );
}
