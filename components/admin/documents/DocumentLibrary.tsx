"use client";
import "@/components/admin/form-fields.css";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VendorDocument } from "@/lib/data/planning";
import { DOCUMENT_KINDS, documentKindLabel, documentName, documentSize, type DocumentVendor } from "@/lib/documents";
import { DocumentUpload } from "./DocumentUpload";

export function DocumentLibrary({ documents, vendors, vendorId, canEdit }: {
  documents: VendorDocument[]; vendors: DocumentVendor[]; vendorId?: string; canEdit: boolean;
}) {
  const router = useRouter();
  const uploadId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [uploaded, setUploaded] = useState<VendorDocument[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setUploaded([]); setRemoved([]); }, [documents]);
  const names = new Map(vendors.map(vendor => [vendor.id, vendor.name]));
  const all = Array.from(new Map([...uploaded, ...documents].map(document => [document.id, document])).values())
    .filter(document => !removed.includes(document.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const search = query.trim().toLocaleLowerCase();
  const visible = all.filter(document => (kind === "all" || document.kind === kind)
    && (!vendorFilter || document.vendor_id === vendorFilter)
    && `${document.name} ${names.get(document.vendor_id) ?? ""} ${documentKindLabel(document.kind)}`.toLocaleLowerCase().includes(search));
  const Heading = vendorId ? "h2" : "h1";

  return <section className={`flex min-w-0 flex-col gap-5 ${vendorId ? "rounded-xl border border-hairline bg-paper/40 p-5" : ""}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><Heading className={vendorId ? "font-semibold" : "text-[22px] font-semibold"}>Documents</Heading>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">{vendorId ? "Keep this vendor’s contracts, quotes, and receipts together." : "Your vendor contracts, quotes, and receipts in one place."}</p>
      </div>
      {canEdit && <button ref={addButton} type="button" aria-expanded={adding} aria-controls={uploadId} onClick={() => { setAdding(true); setNotice(""); }} className="min-h-11 shrink-0 rounded-lg bg-olive-deep px-4 py-2 text-sm font-semibold text-cream hover:bg-olive-deeper">＋ Add documents</button>}
    </div>
    {notice && <p role="status" className="rounded-lg bg-sage-band px-4 py-3 text-sm text-olive-deep">{notice}</p>}
    {adding && canEdit && <div id={uploadId}><DocumentUpload vendorId={vendorId} vendors={vendors}
      onSaved={saved => { setUploaded(current => [...saved, ...current]); setQuery(""); setKind("all"); setVendorFilter(""); router.refresh(); }}
      onClose={() => { setAdding(false); addButton.current?.focus(); }} onRefresh={() => router.refresh()} />
    </div>}
    {all.length > 0 && <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-xs font-medium text-muted">Find a document<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={vendorId ? "Search by name…" : "Search by file or vendor name…"} className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-white/80 px-3 py-2 text-sm text-ink" /></label>
        {!vendorId && vendors.length > 1 && <label className="w-full text-xs font-medium text-muted sm:w-auto">Vendor<select value={vendorFilter} onChange={event => setVendorFilter(event.target.value)} className="admin-field mt-1 min-h-11 w-full rounded-lg border border-hairline bg-white/80 px-3 py-2 text-sm text-ink sm:max-w-56"><option value="">All vendors</option>{vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>}
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Filter documents by type">
        {[{ value: "all", label: "All files" }, ...DOCUMENT_KINDS].map(option => <button key={option.value} type="button" aria-pressed={kind === option.value} onClick={() => setKind(option.value)} className={`min-h-10 rounded-full px-3 py-2 text-xs font-medium ${kind === option.value ? "bg-olive-deep text-cream" : "bg-white/70 text-muted hover:bg-sage-band"}`}>{option.label}</button>)}
      </div>
      <p role="status" className="text-xs text-muted">{visible.length} {visible.length === 1 ? "file" : "files"}{visible.length !== all.length ? ` of ${all.length}` : ""} · Newest first</p>
    </>}
    {!all.length && !adding && <div className="rounded-xl border border-dashed border-olive/20 bg-white/40 px-5 py-9 text-center">
      <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="mx-auto mb-3 text-olive"><path d="M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9zM14 2v7h7M7 13h10M7 17h6" /></svg>
      <h3 className="font-medium">A home for your paperwork</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{canEdit ? "Add a contract, quote, or receipt so it’s easy to find when you need it." : "Your wedding team’s uploaded files will appear here."}</p>
      {canEdit && <button type="button" onClick={() => setAdding(true)} className="mt-4 min-h-11 rounded-lg border border-olive/30 px-4 py-2 text-sm font-medium text-olive-deep hover:bg-sage-band">Add your first document</button>}
    </div>}
    {!!all.length && !visible.length && <div className="rounded-xl border border-hairline bg-white/40 px-5 py-8 text-center"><p className="text-sm text-muted">No files match this search.</p><button type="button" onClick={() => { setQuery(""); setKind("all"); setVendorFilter(""); }} className="mt-2 min-h-11 px-3 text-sm text-olive underline">Clear search and filters</button></div>}
    {visible.length > 0 && <ul className="flex min-w-0 flex-col gap-3">{visible.map(document => <DocumentRow key={document.id} document={document} vendorName={vendorId ? undefined : names.get(document.vendor_id)} canEdit={canEdit} onRemoved={() => { setRemoved(current => [...current, document.id]); setNotice(`${documentName(document.name)} removed.`); router.refresh(); }} />)}</ul>}
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted"><p>Private to your wedding team.</p>{vendorId && <Link href="/admin/documents" className="py-2 text-olive underline">See all documents →</Link>}</div>
  </section>;
}

function DocumentRow({ document, vendorName, canEdit, onRemoved }: { document: VendorDocument; vendorName?: string; canEdit: boolean; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false);
  const name = documentName(document.name);
  const href = `/admin/vendors/documents?id=${encodeURIComponent(document.id)}`;
  const format = ({ "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG", "text/plain": "TXT" } as Record<string, string>)[document.mime_type] ?? "FILE";
  const added = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(document.created_at));

  async function remove() {
    if (working.current) return;
    working.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/admin/vendors/documents", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: document.id }) });
      const result = await response.json();
      if (response.ok) onRemoved();
      else setError(result.message || "The file couldn’t be removed. Try again.");
    } catch { setError("We couldn’t confirm removal. Refresh this page before trying again."); }
    finally { working.current = false; setPending(false); }
  }

  return <li className="min-w-0 rounded-xl border border-hairline bg-white/65 p-4">
    <div className="flex min-w-0 items-start gap-3">
      <span aria-hidden="true" className="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg bg-sage-band text-[10px] font-bold tracking-wide text-olive-deep">{format}</span>
      <div className="min-w-0 flex-1">
        <a href={`${href}&preview=1`} target="_blank" rel="noreferrer" className="break-words text-sm font-semibold text-ink hover:text-olive hover:underline" aria-label={`Open ${name} in a new tab`}>{name}</a>
        {vendorName && <Link href={`/admin/vendors/${document.vendor_id}`} className="mt-1 block w-fit max-w-full break-words text-xs text-olive hover:underline">{vendorName}</Link>}
        <p className="mt-1 text-xs leading-relaxed text-muted">{documentKindLabel(document.kind)} · {documentSize(document.size_bytes)}<br /><time dateTime={document.created_at}>Added {added}</time></p>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-hairline pt-2">
      <a href={`${href}&preview=1`} target="_blank" rel="noreferrer" aria-label={`Open ${name} in a new tab`} className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-olive-deep hover:bg-sage-band">Open ↗</a>
      <a href={href} aria-label={`Download ${name}`} className="flex min-h-11 items-center rounded-lg px-3 text-sm text-muted hover:bg-sage-band">Download</a>
      {canEdit && !confirming && <button type="button" aria-label={`Remove ${name}`} onClick={() => setConfirming(true)} className="ml-auto min-h-11 rounded-lg px-3 text-xs text-muted hover:text-rose-deep">Remove</button>}
    </div>
    {confirming && <div className="mt-2 rounded-lg bg-blush p-3"><p className="break-words text-sm font-medium">Remove “{name}”?</p><p className="mt-1 text-xs leading-relaxed text-rose-deep">This permanently deletes the file for everyone on your wedding team.</p>
      {error && <p role="alert" className="mt-2 text-sm text-rose-deep">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2"><button autoFocus type="button" disabled={pending} onClick={() => { setConfirming(false); setError(""); }} className="min-h-11 rounded-lg border border-blush-border bg-white px-3 text-sm">Keep file</button><button type="button" disabled={pending} onClick={() => void remove()} className="min-h-11 rounded-lg px-3 text-sm text-rose-deep disabled:opacity-40">{pending ? "Removing…" : "Remove file"}</button></div>
    </div>}
  </li>;
}
