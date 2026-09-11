import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { documents } from "@/lib/data/planning";
import { readAll } from "@/lib/data/query";
import type { DocumentVendor } from "@/lib/documents";
import { DocumentLibrary } from "@/components/admin/documents/DocumentLibrary";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  const [files, vendors] = await Promise.all([
    documents(scope),
    readAll<DocumentVendor>(() => scope.db.from("vendors").select("id,name").eq("wedding_id", scope.weddingId).order("name").order("id")),
  ]);
  return <div className="mx-auto w-full max-w-5xl"><DocumentLibrary documents={files} vendors={vendors} canEdit={admin.role !== "viewer"} /></div>;
}
