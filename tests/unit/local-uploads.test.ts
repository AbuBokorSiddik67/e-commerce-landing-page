import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "@/app/uploads/[...key]/route";
import { localUploadInfo, removeFile, storeFile, validateUpload } from "@/lib/storage";

let scratch: string;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]);
const request = (range?: string) => new Request("http://fixture.invalid/uploads/file", { headers: range ? { Range: range } : undefined });
const context = (key: string) => ({ params: Promise.resolve({ key: key.split("/") }) });

beforeEach(async () => {
  const root = path.resolve(process.cwd(), "tmp");
  await mkdir(root, { recursive: true });
  scratch = await mkdtemp(path.join(root, "local-upload-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(scratch);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(scratch, { recursive: true, force: true });
});

describe("local media storage", () => {
  it("immediately serves new files, supports HEAD and byte ranges, and removes them", async () => {
    expect(validateUpload("image/png", png)).toBe("png");
    const uploaded = await storeFile(png, "image/png", "png");
    expect(uploaded.url).toBe(`/uploads/${uploaded.key}`);
    const full = await GET(request(), context(uploaded.key));
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("image/png");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await full.arrayBuffer())).toEqual(png);
    const partial = await GET(request("bytes=2-5"), context(uploaded.key));
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(png.subarray(2, 6));
    const suffix = await GET(request("bytes=-3"), context(uploaded.key));
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(png.subarray(-3));
    expect((await GET(request("bytes=100-"), context(uploaded.key))).status).toBe(416);
    const head = await HEAD(request(), context(uploaded.key));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");
    expect(await head.text()).toBe("");
    await removeFile(uploaded.key);
    expect((await GET(request(), context(uploaded.key))).status).toBe(404);
  });

  it("reads and deletes files from the legacy public/uploads location", async () => {
    const key = "2026-11/123e4567-e89b-42d3-a456-426614174000.png";
    const info = localUploadInfo(key);
    if (!info) throw new Error("Invalid fixture key");
    await mkdir(path.dirname(info.legacyPath), { recursive: true });
    await writeFile(info.legacyPath, png);
    const response = await GET(request(), context(key));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    await removeFile(key);
    expect((await GET(request(), context(key))).status).toBe(404);
  });

  it("rejects traversal, invalid keys, wrong content types and mismatched signatures", async () => {
    expect(localUploadInfo("../../.env")).toBeNull();
    expect(localUploadInfo("2026-11/../../.env")).toBeNull();
    expect((await GET(request(), context("../../.env"))).status).toBe(404);
    await expect(removeFile("../../.env")).rejects.toThrow(/Invalid upload key/);
    expect(() => validateUpload("image/svg+xml", png)).toThrow(/Unsupported/);
    expect(() => validateUpload("image/jpeg", png)).toThrow(/does not match/);
  });
});
