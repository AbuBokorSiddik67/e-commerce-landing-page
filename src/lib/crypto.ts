import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function encryptionKey() {
  const configured = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === "production" && (!configured || Buffer.byteLength(configured, "utf8") < 32)) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be at least 32 bytes in production");
  }
  if (!configured) return createHash("sha256").update("landiq-development-only-key").digest();
  // Derive a stable 32-byte key from whatever long secret the operator supplied.
  return createHash("sha256").update(configured).digest();
}

/** Credentials are encrypted at rest. Ciphertext is never returned to the browser. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [iv, tag, body] = payload.split(".");
  if (!iv || !tag || !body) throw new Error("Invalid encrypted credential");
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function orderNumber() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `LDQ-${stamp}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Constant-time comparison for webhook signatures / IPN secrets. */
export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function fingerprint(ip: string | null, userAgent: string | null) {
  return hashToken(`${ip ?? "unknown"}|${userAgent ?? "unknown"}`);
}
