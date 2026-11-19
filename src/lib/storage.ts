import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "./config";
import { AppError } from "./errors";

const ALLOWED = new Map<string, { ext: string; signature?: (b: Buffer) => boolean }>([
  ["image/jpeg", { ext: "jpg", signature: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ["image/png", { ext: "png", signature: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) }],
  ["image/webp", { ext: "webp", signature: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" }],
  ["image/gif", { ext: "gif", signature: (b) => b.subarray(0, 4).toString() === "GIF8" }],
  ["video/mp4", { ext: "mp4", signature: (b) => b.subarray(4, 8).toString() === "ftyp" }],
  ["video/webm", { ext: "webm", signature: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) }],
]);

const MAX_BYTES = 20 * 1024 * 1024;

export function validateUpload(mime: string, bytes: Buffer) {
  const config = ALLOWED.get(mime.toLowerCase());
  if (!config) throw new AppError("Unsupported file type", "INVALID_FILE", 415);
  if (bytes.length > MAX_BYTES) throw new AppError("File exceeds the 20 MB limit", "FILE_TOO_LARGE", 413);
  if (config.signature && !config.signature(bytes)) throw new AppError("File content does not match its type", "INVALID_SIGNATURE", 415);
  return config.ext;
}

function s3() {
  const e = env();
  if (!e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
    throw new AppError("S3 storage is not configured", "STORAGE_CONFIG", 500);
  }
  return new S3Client({
    region: e.S3_REGION || "us-east-1",
    endpoint: e.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(e.S3_ENDPOINT),
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  });
}

export async function storeFile(bytes: Buffer, mime: string, ext: string) {
  const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  const e = env();
  if (e.STORAGE_DRIVER === "s3") {
    await s3().send(new PutObjectCommand({
      Bucket: e.S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    }));
    const base = (e.S3_PUBLIC_BASE_URL || (e.S3_ENDPOINT ? `${e.S3_ENDPOINT}/${e.S3_BUCKET}` : `https://${e.S3_BUCKET}.s3.${e.S3_REGION}.amazonaws.com`)).replace(/\/$/, "");
    return { key, url: `${base}/${key}` };
  }
  const filePath = path.join(process.cwd(), "public", "uploads", key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  return { key, url: `/uploads/${key}` };
}

export async function removeFile(key: string) {
  const e = env();
  if (e.STORAGE_DRIVER === "s3") {
    await s3().send(new DeleteObjectCommand({ Bucket: e.S3_BUCKET, Key: key }));
    return;
  }
  const filePath = path.join(process.cwd(), "public", "uploads", key);
  await unlink(filePath).catch(() => undefined);
}
