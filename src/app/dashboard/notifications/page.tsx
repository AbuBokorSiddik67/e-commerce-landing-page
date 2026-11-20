import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { markNotificationsReadAction, notificationChannelAction } from "@/app/actions/settings";
import { formatDate } from "@/lib/utils";
import { Badge, Card, PageHeader, ToggleRow } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requirePageAccess(PERMISSIONS.NOTIFICATION_VIEW);
  const [notifications, logs, inapp, email, sms] = await Promise.all([
    prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    getSetting<{ enabled: boolean }>("notification_inapp", { enabled: true }),
    getSetting<{ enabled: boolean }>("notification_email", { enabled: false }),
    getSetting<{ enabled: boolean }>("notification_sms", { enabled: false }),
  ]);
  const channels = [{ key: "inapp", label: "In-app notifications", config: inapp }, { key: "email", label: "E-mail", config: email }, { key: "sms", label: "SMS", config: sms }];
  return (
    <>
      <PageHeader title="Notifications" description="Delivery logs record actual provider acceptance. Skipped channels are never reported as sent." action={<form action={markNotificationsReadAction}><button className="btn-secondary">Mark all read</button></form>} />
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]"><Card className="h-fit p-6"><h2 className="font-semibold">Channels</h2>{channels.map((channel) => <form key={channel.key} action={notificationChannelAction}><input type="hidden" name="channel" value={channel.key} /><ToggleRow title={channel.label} description={channel.key === "email" ? "Requires SMTP environment variables" : channel.key === "sms" ? "Requires an SMS gateway URL" : "Visible inside this dashboard"}><input type="checkbox" name="enabled" defaultChecked={channel.config.enabled} className="h-5 w-5" /><button className="ml-2 text-xs font-semibold text-brand-700">Save</button></ToggleRow></form>)}</Card>
        <div className="space-y-6"><Card className="p-6"><h2 className="font-semibold">Notification inbox</h2><div className="mt-4 space-y-3">{notifications.map((n) => <div key={n.id} className="flex items-start justify-between gap-3 border-b border-ink-100 pb-3 last:border-0"><div><p className="text-sm font-medium">{n.title}</p><p className="text-xs text-ink-500">{n.body}</p><p className="text-xs text-ink-400">{n.channel} · {formatDate(n.createdAt)}</p></div><Badge tone={n.readAt ? "success" : "warning"}>{n.status}</Badge></div>)}{!notifications.length && <p className="text-sm text-ink-500">No notifications yet.</p>}</div></Card>
          <Card className="p-6"><h2 className="font-semibold">Delivery logs</h2><div className="table-wrap mt-4"><table className="table"><thead><tr><th>Channel</th><th>Recipient</th><th>Status</th><th>Time</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{log.provider}</td><td>{log.recipient}</td><td><Badge tone={log.status === "FAILED" ? "danger" : log.status === "SKIPPED" ? "neutral" : "success"}>{log.status}</Badge>{log.error && <p className="text-xs text-red-600">{log.error.slice(0, 80)}</p>}</td><td>{formatDate(log.createdAt)}</td></tr>)}</tbody></table>{!logs.length && <p className="p-4 text-sm text-ink-500">No delivery attempts recorded.</p>}</div></Card></div>
      </div>
    </>
  );
}
