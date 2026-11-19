import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { removeFile, storeFile, validateUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";

export async function uploadMedia(file: File, folder: string, alt: string, actorId: string) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = validateUpload(file.type, bytes);
  const stored = await storeFile(bytes, file.type, ext);
  const asset = await prisma.mediaAsset.create({
    data: {
      name: file.name.slice(0, 200), key: stored.key, url: stored.url,
      mimeType: file.type, size: bytes.length, alt: alt || null, folder: folder || "General",
    },
  });
  await audit({ actorId, action: "UPLOAD_MEDIA", entity: "MediaAsset", entityId: asset.id, after: { key: stored.key } });
  return asset;
}

export async function listMedia(options: { search?: string; folder?: string; page?: number; perPage?: number } = {}) {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(100, options.perPage ?? 24);
  const where = {
    ...(options.folder ? { folder: options.folder } : {}),
    ...(options.search ? { name: { contains: options.search, mode: "insensitive" as const } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.mediaAsset.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage }),
    prisma.mediaAsset.count({ where }),
  ]);
  return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
}

export async function deleteMedia(id: string, actorId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) throw new AppError("Media asset not found", "NOT_FOUND", 404);
  await removeFile(asset.key);
  await prisma.mediaAsset.delete({ where: { id } });
  await audit({ actorId, action: "DELETE_MEDIA", entity: "MediaAsset", entityId: id, before: { key: asset.key } });
}
