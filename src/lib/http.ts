import { AppError } from "./errors";

/** Read a small external callback without buffering an unbounded request body. */
export async function readLimitedText(request: Request, limit: number) {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    throw new AppError("Request body is too large", "BODY_TOO_LARGE", 413);
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel().catch(() => undefined);
        throw new AppError("Request body is too large", "BODY_TOO_LARGE", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** Reject cross-site form/JSON posts to state-changing public endpoints. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // Requests without Origin (server-to-server) rely on server validation.
  const host = request.headers.get("host");
  if (!host) throw new AppError("Missing host header", "FORBIDDEN", 403);
  try {
    if (new URL(origin).host !== host) throw new AppError("Cross-origin request rejected", "FORBIDDEN", 403);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Invalid origin", "FORBIDDEN", 403);
  }
}
