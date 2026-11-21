import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { localUploadInfo } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ key: string[] }> };

// A single byte range is enough for browser video playback and seeking.
function byteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

async function serve(request: Request, context: Context, head: boolean) {
  const info = localUploadInfo((await context.params).key.join("/"));
  if (!info) return new Response(null, { status: 404 });
  let file: FileHandle | undefined;
  try {
    for (const candidate of [info.path, info.legacyPath]) {
      try { file = await open(candidate, "r"); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (!file) return new Response(null, { status: 404 });
    const stat = await file.stat();
    if (!stat.isFile()) { await file.close(); return new Response(null, { status: 404 }); }
    const headers = new Headers({
      "Content-Type": info.mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    });
    // Without an ETag or Last-Modified validator, If-Range must receive the
    // whole file rather than an incorrectly conditional partial response.
    const requestedRange = request.headers.has("if-range") ? null : request.headers.get("range");
    const range = requestedRange ? byteRange(requestedRange, stat.size) : null;
    if (requestedRange && !range) {
      headers.set("Content-Range", `bytes */${stat.size}`);
      await file.close();
      return new Response(null, { status: 416, headers });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? stat.size - 1;
    headers.set("Content-Length", String(range ? end - start + 1 : stat.size));
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    if (head || stat.size === 0) {
      await file.close();
      return new Response(null, { status: range ? 206 : 200, headers });
    }
    // Stream the file instead of buffering up to 20 MB for every request.
    const stream = Readable.toWeb(file.createReadStream({ start, end })) as ReadableStream;
    file = undefined; // The stream owns the handle and closes it.
    return new Response(stream, { status: range ? 206 : 200, headers });
  } catch {
    await file?.close().catch(() => undefined);
    return new Response(null, { status: 500 });
  }
}

export async function GET(request: Request, context: Context) { return serve(request, context, false); }
export async function HEAD(request: Request, context: Context) { return serve(request, context, true); }
