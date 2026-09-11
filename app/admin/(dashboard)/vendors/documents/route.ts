import { requireAdmin, requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as vendors from "@/lib/data/vendors";
import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DOCUMENT_KINDS, DOCUMENT_MAX_BYTES, documentDownloadName } from "@/lib/documents";
const BUCKET = "wedding-documents";
const MAX_BYTES = DOCUMENT_MAX_BYTES;
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ message: "Invalid request origin." }, { status: 403 });
    const admin = await requireEditor(); const scope = forWedding(admin.weddingId);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 65536) return Response.json({ message: "Choose a file under 3 MB." }, { status: 413 });
    const form = await request.formData(); const file = form.get("file"); const vendorId = String(form.get("vendorId") ?? "");
    const kind = String(form.get("kind") ?? "document");
    if (!DOCUMENT_KINDS.some(option => option.value === kind)) return Response.json({ message: "Choose a document type." }, { status: 400 });
    await vendors.get(scope, vendorId);
    if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) return Response.json({ message: "Choose a non-empty PDF, JPEG, PNG, or text file under 3 MB." }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const prefix = new TextDecoder().decode(bytes.slice(0, 5));
    let mime: string;
    if (prefix === "%PDF-") mime = "application/pdf";
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = "image/jpeg";
    else if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) mime = "image/png";
    else if (file.type === "text/plain" && !bytes.includes(0)) mime = "text/plain";
    else return Response.json({ message: "This file type is not supported. Use PDF, JPEG, PNG, or plain text." }, { status: 400 });
    const id = crypto.randomUUID(); const path = `${scope.weddingId}/${vendorId}/${id}`;
    const name = String(form.get("name") || file.name).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 250) || "Document";
    const document = { id, vendor_id: vendorId, name, kind, mime_type: mime, size_bytes: file.size, created_at: new Date().toISOString() };
    const upload = await scope.db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (upload.error) throw new Error(upload.error.message);
    const { error } = await scope.db.from("vendor_documents").insert({ ...document, wedding_id: scope.weddingId, storage_path: path });
    if (error) { await scope.db.storage.from(BUCKET).remove([path]); throw new Error(error.message); }
    revalidatePath(`/admin/vendors/${vendorId}`);
    revalidatePath("/admin/documents");
    return Response.json({ ok: true, document });
  } catch (error) { unstable_rethrow(error); return Response.json({ message: error instanceof Error ? error.message : "The document could not be uploaded." }, { status: 400 }); }
}
export async function GET(request: Request) {
  const admin = await requireAdmin(); const scope = forWedding(admin.weddingId); const params = new URL(request.url).searchParams; const id = params.get("id");
  const { data, error } = await scope.db.from("vendor_documents").select("storage_path,name,mime_type").eq("wedding_id", scope.weddingId).eq("id", id).maybeSingle();
  if (error || !data) return Response.json({ message: "Document not found." }, { status: 404 });
  const signed = await scope.db.storage.from(BUCKET).createSignedUrl(data.storage_path, 60, params.get("preview") === "1" ? {} : { download: documentDownloadName(data.name, data.mime_type) });
  if (signed.error) return Response.json({ message: "The document could not be downloaded." }, { status: 503 });
  return new Response(null, { status: 302, headers: { Location: signed.data.signedUrl, "Cache-Control": "private, no-store" } });
}
export async function DELETE(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ message: "Invalid request origin." }, { status: 403 });
    const admin = await requireEditor(); const scope = forWedding(admin.weddingId); const { id } = await request.json();
    const { data, error } = await scope.db.from("vendor_documents").select("storage_path,vendor_id").eq("wedding_id", scope.weddingId).eq("id", id).single();
    if (error || !data) throw new Error("Document not found.");
    const removed = await scope.db.storage.from(BUCKET).remove([data.storage_path]);
    if (removed.error) throw new Error(removed.error.message);
    const result = await scope.db.from("vendor_documents").delete().eq("wedding_id", scope.weddingId).eq("id", id);
    if (result.error) throw new Error(result.error.message);
    revalidatePath(`/admin/vendors/${data.vendor_id}`); revalidatePath("/admin/documents"); return Response.json({ ok: true });
  } catch (error) { unstable_rethrow(error); return Response.json({ message: error instanceof Error ? error.message : "The document could not be removed." }, { status: 400 }); }
}
