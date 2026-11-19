"use client";
import { useActionState } from "react";
import { contactAction } from "@/app/actions/contact";
import { Button, Field } from "@/components/ui";

export function ContactForm() {
  const [state, action, pending] = useActionState(contactAction, undefined);
  if (state?.ok) return <div className="alert-success">Thank you — your message has been received.</div>;
  return (
    <form action={action} className="space-y-4">
      {state?.error && <div className="alert-error">{state.error}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" required><input className="input" name="name" required /></Field>
        <Field label="Email" name="email" required><input className="input" type="email" name="email" required /></Field>
      </div>
      <Field label="Subject" name="subject" required><input className="input" name="subject" required /></Field>
      <Field label="Message" name="message" required><textarea className="textarea" name="message" required /></Field>
      <Button disabled={pending}>{pending ? "Sending…" : "Send message"}</Button>
    </form>
  );
}
