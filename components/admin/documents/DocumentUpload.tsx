"use client";
import "@/components/admin/form-fields.css";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { VendorDocument } from "@/lib/data/planning";
import { DOCUMENT_ACCEPT, DOCUMENT_KINDS, documentFileError, documentName, documentSize, suggestDocumentKind, type DocumentKind, type DocumentVendor } from "@/lib/documents";

type Upload = {
  id: string; file: File; name: string; kind: DocumentKind;
  status: "ready" | "invalid" | "uploading" | "saved" | "failed" | "uncertain";
  message?: string;
};
const field = "admin-field mt-1 min-h-11 w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink";

export function DocumentUpload({ vendorId, vendors, onSaved, onClose, onRefresh }: {
  vendorId?: string; vendors: DocumentVendor[]; onSaved: (documents: VendorDocument[]) => void; onClose: () => void; onRefresh: () => void;
}) {
  const helpId = useId();
  const working = useRef(false);
  const [selectedVendor, setSelectedVendor] = useState(vendorId ?? (vendors.length === 1 ? vendors[0].id : ""));
  const [files, setFiles] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const ready = files.filter(file => file.status === "ready" || file.status === "failed");
  const uncertain = files.some(file => file.status === "uncertain");

  function addFiles(incoming: File[]) {
    if (working.current) return;
    setAnnouncement("");
    setFiles(current => {
      const next = [...current];
      for (const file of incoming) {
        if (next.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
        const error = documentFileError(file);
        next.push({ id: crypto.randomUUID(), file, name: documentName(file.name).slice(0, 250), kind: suggestDocumentKind(file.name), status: error ? "invalid" : "ready", message: error ?? undefined });
      }
      return next;
    });
  }

  function update(id: string, patch: Partial<Upload>) {
    setFiles(current => current.map(file => file.id === id ? { ...file, ...patch } : file));
  }

  async function upload() {
    if (working.current || !selectedVendor || !ready.length) return;
    working.current = true;
    setBusy(true);
    const saved: VendorDocument[] = [];
    let failures = 0;
    for (const [index, item] of ready.entries()) {
      setAnnouncement(`Uploading ${index + 1} of ${ready.length}…`);
      update(item.id, { status: "uploading", message: undefined });
      const data = new FormData();
      data.set("vendorId", selectedVendor);
      data.set("file", item.file);
      data.set("name", item.name.trim() || documentName(item.file.name));
      data.set("kind", item.kind);
      try {
        const response = await fetch("/admin/vendors/documents", { method: "POST", body: data });
        const result = await response.json();
        if (!response.ok) {
          failures++;
          update(item.id, { status: "failed", message: result.message || "This file couldn’t be uploaded. Try again." });
        } else if (result.document?.id) {
          saved.push(result.document);
          update(item.id, { status: "saved", message: "Uploaded" });
        } else {
          throw new Error("Upload result is missing");
        }
      } catch {
        failures++;
        update(item.id, { status: "uncertain", message: "The connection was interrupted. Refresh saved files below to check whether this arrived before adding it again." });
      }
    }
    if (saved.length) onSaved(saved);
    setAnnouncement(`${saved.length} ${saved.length === 1 ? "file" : "files"} uploaded.${failures ? ` ${failures} ${failures === 1 ? "file needs" : "files need"} attention below.` : " You can find them in your documents."}`);
    setBusy(false);
    working.current = false;
  }

  return <form onSubmit={event => { event.preventDefault(); void upload(); }} className="flex flex-col gap-4 rounded-xl border border-olive/20 bg-paper p-4 sm:p-5">
    <div><h3 className="font-semibold">Add documents</h3><p className="mt-1 text-sm text-muted">Choose your files, check their names, and upload.</p></div>
    {!vendorId && !vendors.length ? <p className="text-sm">Start by <Link href="/admin/vendors?new=1" className="text-olive underline">adding a vendor</Link> so their files stay together.</p> : <>
      {!vendorId && <label className="text-sm font-medium">Save these files under
        <select required disabled={busy} value={selectedVendor} onChange={event => setSelectedVendor(event.target.value)} className={field}>
          <option value="">Choose a vendor</option>{vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
      </label>}
      <label onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }} className={`relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors focus-within:border-olive ${dragging ? "border-olive bg-sage-band" : "border-olive/25 bg-white/70 hover:border-olive/60"} ${busy ? "opacity-50" : ""}`}>
        <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-olive"><path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
        <span className="text-sm font-semibold text-olive-deep">Choose files<span className="hidden font-normal sm:inline"> or drag them here</span></span>
        <span id={helpId} className="text-xs leading-relaxed text-muted">PDF, JPG, PNG, or text · Up to 3 MB each<br />You can add several files at once.</span>
        <input type="file" multiple accept={DOCUMENT_ACCEPT} disabled={busy} aria-label="Choose documents to upload" aria-describedby={helpId} onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait" />
      </label>
      {files.length > 0 && <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">Names and types are suggested from the filenames. You can change them.</p>
        {files.map(item => <div key={item.id} className="rounded-lg border border-hairline bg-white p-3">
          <div className="flex items-start gap-2"><p className="min-w-0 flex-1 break-words text-xs text-muted">{item.file.name} · {documentSize(item.file.size)}</p>
            {item.status !== "saved" && <button type="button" disabled={busy} aria-label={`Remove ${item.file.name} from upload list`} onClick={() => setFiles(current => current.filter(file => file.id !== item.id))} className="-my-2 -mr-2 flex min-h-11 min-w-11 items-center justify-center rounded text-lg text-muted hover:text-ink disabled:opacity-40">×</button>}
          </div>
          {item.status !== "invalid" && item.status !== "saved" && <fieldset disabled={busy || item.status === "uncertain"} className={`mt-2 grid min-w-0 gap-3 ${vendorId ? "" : "sm:grid-cols-[minmax(0,1fr)_150px]"}`}>
            <label className="min-w-0 text-xs font-medium">Document name<input required maxLength={250} value={item.name} onChange={event => update(item.id, { name: event.target.value })} className={field} /></label>
            <label className="text-xs font-medium">Type<select value={item.kind} onChange={event => update(item.id, { kind: event.target.value as DocumentKind })} className={field}>{DOCUMENT_KINDS.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></label>
          </fieldset>}
          {item.message && <p role={item.status === "saved" ? "status" : "alert"} className={`mt-2 text-sm ${item.status === "saved" ? "text-olive-deep" : "text-rose-deep"}`}>{item.status === "saved" ? "✓ " : ""}{item.message}</p>}
        </div>)}
      </div>}
    </>}
    <p role="status" aria-live="polite" className={`text-sm ${announcement ? "" : "sr-only"}`}>{announcement}</p>
    {uncertain && <button type="button" onClick={onRefresh} disabled={busy} className="self-start text-sm text-olive underline">Refresh saved files</button>}
    <div className="flex flex-wrap items-center gap-3">
      {(vendorId || vendors.length > 0) && <button disabled={busy || !ready.length || !selectedVendor} className="min-h-11 rounded-lg bg-olive-deep px-4 py-2 text-sm font-semibold text-cream hover:bg-olive-deeper disabled:opacity-40">{busy ? "Uploading…" : `Upload${ready.length ? ` ${ready.length} ${ready.length === 1 ? "file" : "files"}` : " files"}`}</button>}
      <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-lg px-3 py-2 text-sm text-muted disabled:opacity-40">{files.some(file => file.status === "saved") ? "Done" : "Cancel"}</button>
    </div>
  </form>;
}
