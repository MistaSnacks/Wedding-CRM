export const DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.txt";
export const DOCUMENT_KINDS = [
  { value: "contract", label: "Contract" },
  { value: "quote", label: "Quote" },
  { value: "receipt", label: "Receipt" },
  { value: "document", label: "Other document" },
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]["value"];
export type DocumentVendor = { id: string; name: string };

export function documentKindLabel(kind: string) {
  return DOCUMENT_KINDS.find(option => option.value === kind)?.label ?? "Other document";
}

export function suggestDocumentKind(name: string): DocumentKind {
  const words = name.toLowerCase().replace(/[_-]/g, " ");
  if (/\b(receipt|paid|comprobante|recibo)\b/.test(words)) return "receipt";
  if (/\b(contract|agreement|contrato)\b/.test(words)) return "contract";
  if (/\b(quote|proposal|estimate|cotizacion|cotización|presupuesto)\b/.test(words)) return "quote";
  return "document";
}

export function documentName(name: string) {
  return name.replace(/\.(pdf|jpe?g|png|txt)$/i, "").replace(/_/g, " ").trim() || "Document";
}

export function documentFileError(file: { name: string; size: number; type: string }): string | null {
  if (!file.size) return "This file is empty. Choose a saved copy instead.";
  if (file.size > DOCUMENT_MAX_BYTES) return "This file is over 3 MB. Choose a smaller copy or compress the PDF first.";
  if (!/\.(pdf|jpe?g|png|txt)$/i.test(file.name)) {
    return "Choose a PDF, JPG, PNG, or text file. For Word or Excel, save a PDF copy first.";
  }
  return null;
}

export function documentSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function documentDownloadName(name: string, mime: string) {
  const extension: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "text/plain": "txt" };
  const suffix = extension[mime];
  const clean = name.replace(/[\x00-\x1f\x7f/\\]/g, "").trim().slice(0, 240) || "Document";
  if (!suffix) return clean;
  const existing = clean.match(/\.([^.]+)$/)?.[1].toLowerCase();
  return existing === suffix || (mime === "image/jpeg" && existing === "jpeg") ? clean : `${clean}.${suffix}`;
}
