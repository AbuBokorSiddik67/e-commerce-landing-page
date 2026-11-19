import { prisma } from "@/lib/prisma";
import { deleteMediaAction } from "@/app/actions/products";
import { uploadMediaAction } from "@/app/actions/catalog";
import { listMedia } from "@/services/media";
import { Alert, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ page?: string; search?: string; folder?: string; error?: string; success?: string }> }) {
  const params = await searchParams;
  const result = await listMedia({ page: Number(params.page ?? 1), search: params.search, folder: params.folder });
  const folders = await prisma.mediaAsset.groupBy({ by: ["folder"], _count: { folder: true } });
  return (
    <>
      <PageHeader title="Media library" description="Upload validated images and videos, then reuse them across products and pages." />
      <Alert error={params.error} success={params.success} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <form method="get" className="mb-4 flex flex-wrap gap-3"><input className="input max-w-xs" name="search" placeholder="Search files" defaultValue={params.search} /><select className="input max-w-xs" name="folder" defaultValue={params.folder ?? ""}><option value="">All folders</option>{folders.map((f) => <option key={f.folder} value={f.folder}>{f.folder}</option>)}</select><button className="btn-secondary">Filter</button></form>
          {result.items.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{result.items.map((asset) => <div key={asset.id} className="surface overflow-hidden"><div className="grid h-40 place-items-center bg-ink-100">{asset.mimeType.startsWith("image/") ? <img src={asset.url} alt={asset.alt ?? asset.name} className="h-full w-full object-cover" /> : <video src={asset.url} className="h-full w-full object-cover" controls />}</div><div className="p-4"><p className="truncate text-sm font-medium">{asset.name}</p><p className="text-xs text-ink-400">{asset.folder} · {Math.round(asset.size / 1024)} KB · {formatDate(asset.createdAt)}</p><input className="input mt-2 text-xs" readOnly value={asset.url} /><div className="mt-2 flex justify-between"><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="alt" /> Alt text: {asset.alt || "none"}</label><form action={deleteMediaAction}><input type="hidden" name="id" value={asset.id} /><button className="text-xs font-semibold text-red-600">Delete</button></form></div></div></div>)}</div> : <EmptyState title="No media yet" description="Upload an image or short video to reuse it across your storefronts." />}
          <Pagination page={result.page} pages={result.pages} basePath="/dashboard/media" />
        </div>
        <form action={uploadMediaAction} className="surface h-fit space-y-4 p-6"><h2 className="font-semibold">Upload file</h2><label className="block"><span className="label">File</span><input className="input" type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" required /></label><label className="block"><span className="label">Folder</span><input className="input" name="folder" placeholder="General" /></label><label className="block"><span className="label">Alt text</span><input className="input" name="alt" /></label><button className="btn-primary w-full">Upload</button><p className="text-xs text-ink-400">JPEG, PNG, WebP, GIF, MP4 and WebM up to 20 MB. File signatures are verified on the server.</p></form>
      </div>
    </>
  );
}
