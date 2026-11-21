import "server-only";
import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { env } from "./config";
import type { NotificationChannel, NotificationStatus } from "@prisma/client";

type NotifyInput = {
  type: string;
  title: string;
  body: string;
  userId?: string | null;
  customerId?: string | null;
  orderId?: string | null;
  email?: string | null;
  phone?: string | null;
  channels?: NotificationChannel[];
  metadata?: Record<string, unknown>;
};

function channelEnabled(channel: NotificationChannel) {
  return prisma.setting.findUnique({ where: { key: `notification_${channel.toLowerCase().replace("_", "")}` } })
    .then((row) => (row?.value as { enabled?: boolean } | undefined)?.enabled ?? channel === "IN_APP");
}

async function sendEmail(to: string, subject: string, text: string) {
  const e = env();
  if (!e.SMTP_HOST || !e.SMTP_FROM) return { status: "SKIPPED" as NotificationStatus, response: "SMTP not configured", error: null };
  const transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT ?? 587,
    secure: (e.SMTP_PORT ?? 587) === 465,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD ?? "" } : undefined,
  });
  try {
    await transport.sendMail({ from: e.SMTP_FROM, to, subject, text });
    // This is transport acceptance, not proof of final inbox delivery. Do not
    // persist arbitrary SMTP responses which may echo addresses or secrets.
    return { status: "SENT" as NotificationStatus, response: "SMTP server accepted message", error: null };
  } catch {
    return { status: "FAILED" as NotificationStatus, response: null, error: "Email delivery failed" };
  }
}

async function sendSms(to: string, text: string) {
  const e = env();
  if (!e.SMS_API_URL) return { status: "SKIPPED" as NotificationStatus, response: "SMS gateway not configured", error: null };
  try {
    const response = await fetch(e.SMS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${e.SMS_API_TOKEN ?? ""}` },
      body: JSON.stringify({ to, text }),
      signal: AbortSignal.timeout(15_000),
    });
    // Gateways may echo the bearer token, phone or message body. Status codes
    // provide useful diagnostics without storing their untrusted response.
    await response.body?.cancel().catch(() => undefined);
    return response.ok
      ? { status: "ACCEPTED" as NotificationStatus, response: `Gateway accepted request (HTTP ${response.status})`, error: null }
      : { status: "FAILED" as NotificationStatus, response: null, error: `SMS gateway HTTP ${response.status}` };
  } catch {
    return { status: "FAILED" as NotificationStatus, response: null, error: "SMS delivery failed" };
  }
}

export async function sendTransactionalEmail(to: string, subject: string, body: string) {
  return sendEmail(to, subject, body);
}

export async function notify(input: NotifyInput) {
  const channels = input.channels ?? (["IN_APP", "EMAIL"] as NotificationChannel[]);
  const notification = await prisma.notification.create({
    data: {
      type: input.type,
      title: input.title,
      body: input.body,
      userId: input.userId ?? null,
      customerId: input.customerId ?? null,
      orderId: input.orderId ?? null,
      metadata: (input.metadata ?? {}) as never,
      status: channels.includes("IN_APP") ? "SENT" : "PENDING",
      readAt: channels.includes("IN_APP") ? new Date() : null,
    },
  });

  for (const channel of channels) {
    if (channel === "IN_APP") continue;
    if (!(await channelEnabled(channel))) {
      await prisma.notificationLog.create({
        data: { notificationId: notification.id, provider: channel, recipient: "[redacted]", status: "SKIPPED", response: "Channel disabled" },
      });
      continue;
    }
    const recipient = channel === "EMAIL" ? input.email : input.phone;
    if (!recipient) {
      await prisma.notificationLog.create({
        data: { notificationId: notification.id, provider: channel, recipient: "[none]", status: "SKIPPED", response: "No recipient" },
      });
      continue;
    }
    const result = channel === "EMAIL"
      ? await sendEmail(recipient, input.title, input.body)
      : channel === "SMS" || channel === "WHATSAPP"
        ? await sendSms(recipient, input.body)
        : { status: "SKIPPED" as NotificationStatus, response: "Unsupported channel", error: null };
    await prisma.notificationLog.create({
      data: {
        notificationId: notification.id,
        provider: channel,
        recipient: channel === "EMAIL" ? `${recipient.slice(0, 2)}…${recipient.slice(-8)}` : `${recipient.slice(0, 3)}••••${recipient.slice(-2)}`,
        status: result.status,
        response: result.response,
        error: result.error,
      },
    });
  }
  return notification;
}

export async function notifyOwners(type: string, title: string, body: string, metadata?: Record<string, unknown>) {
  const owners = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { key: { in: ["OWNER", "ADMINISTRATOR"] } } } } },
    select: { id: true },
  });
  await Promise.all(owners.map((owner) => notify({ type, title, body, userId: owner.id, channels: ["IN_APP"], metadata })));
}
