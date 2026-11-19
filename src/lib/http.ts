import { AppError } from "./errors";

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
