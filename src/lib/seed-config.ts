import { emailSchema } from "./validation";

/** Validate before the seed opens a transaction or performs any writes. */
export function seedConfig(source: Record<string, string | undefined>) {
  const email = (source.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();
  const password = source.SEED_OWNER_PASSWORD ?? "";
  if (!emailSchema.safeParse(email).success) {
    throw new Error("Set SEED_OWNER_EMAIL to a valid owner email before seeding");
  }
  // bcrypt only considers the first 72 UTF-8 bytes. Reject longer credentials
  // instead of silently allowing different passwords to authenticate equally.
  if (password.length < 16 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Set SEED_OWNER_PASSWORD to a unique password of at least 16 characters and at most 72 UTF-8 bytes");
  }
  const demo = source.SEED_INCLUDE_DEMO ?? "false";
  if (demo !== "true" && demo !== "false") throw new Error("SEED_INCLUDE_DEMO must be true or false");
  return { email, password, includeDemo: demo === "true" };
}
