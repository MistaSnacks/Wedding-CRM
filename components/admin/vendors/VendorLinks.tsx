"use client";
import { useState, useTransition } from "react";
import { deleteVendor, linkVendorItem } from "@/app/admin/(dashboard)/vendors/actions";
export function VendorLinks({ vendorId, vendorName, items, options, canEdit }: {
  vendorId: string; vendorName: string; items: Array<{ id: string; name: string }>;
  options: Array<{ id: string; name: string; categoryName: string }>; canEdit: boolean;
}) {
  const [selected, setSelected] = useState(""); const [typed, setTyped] = useState("");
  const [message, setMessage] = useState(""); const [pending, start] = useTransition();
  function run(action: () => Promise<{ ok?: boolean; message?: string }>) { start(async () => { try { const r = await action(); setMessage(r.message ?? "Saved."); } catch { setMessage("The result could not be confirmed. Refresh before retrying."); } }); }
  return <section className="flex flex-col gap-3 rounded-xl border border-hairline p-5">
    <h2 className="font-semibold">Linked budget lines</h2>
    {message && <p role="status" className="text-sm text-rose-deep">{message}</p>}
    {items.map(i => <div key={i.id} className="flex items-center gap-3 text-sm"><a href="/admin/budget" className="flex-1 text-olive underline">{i.name}</a>{canEdit && <button disabled={pending} onClick={() => run(() => linkVendorItem(vendorId, i.id, false))} className="text-rose-deep">Unlink</button>}</div>)}
    {!items.length && <p className="text-sm text-muted">No budget lines linked yet.</p>}
    {canEdit && <><label className="text-sm">Link an existing line<select value={selected} onChange={e => setSelected(e.target.value)} className="mt-1 w-full rounded-lg border border-hairline bg-white p-2"><option value="">Choose a line</option>{options.map(i => <option key={i.id} value={i.id}>{i.categoryName} · {i.name}</option>)}</select></label><button disabled={pending || !selected} onClick={() => run(() => linkVendorItem(vendorId, selected, true))} className="rounded-lg border border-hairline p-2 text-sm disabled:opacity-40">Link without changing amounts</button>
      <details className="mt-4 border-t border-hairline pt-3"><summary className="cursor-pointer text-sm text-rose-deep">Delete vendor</summary><p className="my-2 text-sm">Budget lines and payments stay; their link to this vendor is removed. Remove uploaded documents first. Planning tasks for this vendor are deleted. Type {vendorName} to confirm.</p><label className="text-sm">Vendor name<input value={typed} onChange={e => setTyped(e.target.value)} className="my-2 w-full rounded-lg border border-hairline p-2" /></label><button disabled={pending || typed.trim() !== vendorName} onClick={() => run(() => deleteVendor(vendorId, typed))} className="text-sm text-rose-deep disabled:opacity-40">Delete vendor and its tasks</button></details></>}
  </section>;
}
