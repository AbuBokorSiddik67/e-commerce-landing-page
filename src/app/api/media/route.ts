import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { listMedia, uploadMedia } from "@/services/media";
import { AppError, toErrorMessage } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    return NextResponse.json({ error: "Request rejected" }, { status: error instanceof AppError ? error.status : 400 });
  }
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, PERMISSIONS.MEDIA_WRITE)) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  try {
    if (!(file instanceof File)) throw new Error("No file provided");
    const asset = await uploadMedia(file, String(form.get("folder") ?? "General"), String(form.get("alt") ?? ""), user.id);
    return NextResponse.json({ ok: true, asset }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const url = new URL(request.url);
  const result = await listMedia({ search: url.searchParams.get("search") ?? undefined, folder: url.searchParams.get("folder") ?? undefined });
  return NextResponse.json(result);
}
