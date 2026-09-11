import type { VendorDocument } from "@/lib/data/planning";
import { DocumentLibrary } from "@/components/admin/documents/DocumentLibrary";

export function VendorDocuments({ vendorId, documents, canEdit }: { vendorId: string; documents: VendorDocument[]; canEdit: boolean }) {
  return <DocumentLibrary key={vendorId} vendorId={vendorId} documents={documents} vendors={[]} canEdit={canEdit} />;
}
