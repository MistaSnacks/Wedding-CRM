"use client";
import "@/components/admin/form-fields.css";
import { useActionState, startTransition } from "react";
import { saveVendor } from "@/app/admin/(dashboard)/vendors/actions";
import { VENDOR_STATUSES, DEFAULT_VENDOR_ROLE_NAMES } from "@/lib/data/vendor-rules";
import { centsToInputValue } from "@/lib/format/money";
import type { VendorRow } from "@/lib/types";

export function VendorForm({ vendor, categories, canEdit, currency = "USD" }: {
  vendor?: VendorRow; categories: Array<{ id: string; name: string }>; canEdit: boolean; currency?: string;
}) {
  const [state, action, pending] = useActionState(saveVendor.bind(null, vendor?.id ?? null), {});
  const field = "admin-field w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm disabled:bg-paper";
  return <form onSubmit={event => { event.preventDefault(); if (pending) return; const form = new FormData(event.currentTarget); startTransition(() => action(form)); }} className="flex flex-col gap-4 rounded-xl border border-hairline bg-paper/40 p-5">
    {state.message && <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-olive" : "text-sm text-rose-deep"}>{state.message}</p>}
    {!canEdit && <p className="text-sm text-muted">You have read-only access.</p>}
    <div><h2 className="font-semibold">{vendor ? "Vendor details" : "Add a vendor"}</h2><p className="mt-1 text-sm text-muted">Start with a name. You can fill in the rest whenever you’re ready.</p></div>
    <fieldset disabled={!canEdit || pending} className="grid min-w-0 gap-4 md:grid-cols-2">
      <label className="text-sm">Vendor name<input name="name" required maxLength={200} defaultValue={vendor?.name} className={field} /></label>
      <label className="text-sm">Service<input name="role" list="vendor-roles" defaultValue={vendor?.role ?? ""} className={field} /><datalist id="vendor-roles">{DEFAULT_VENDOR_ROLE_NAMES.map(r => <option key={r} value={r} />)}</datalist></label>
      <label className="text-sm">Status<select name="status" defaultValue={vendor?.status ?? "researching"} className={field}>{VENDOR_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}</select></label>
      <label className="text-sm">Contact name<input name="contactName" defaultValue={vendor?.contact_name ?? ""} className={field} /></label>
      <label className="text-sm">Company<input name="company" defaultValue={vendor?.company ?? ""} className={field} /></label>
      <label className="text-sm">Email<input name="email" type="email" defaultValue={vendor?.email ?? ""} className={field} /></label>
      <label className="text-sm">Phone<input name="phone" type="tel" defaultValue={vendor?.phone ?? ""} className={field} /></label>
      <details className="min-w-0 rounded-lg border border-hairline p-3 md:col-span-2">
        <summary className="cursor-pointer text-sm font-medium text-olive-deep">Pricing, contract &amp; more details</summary>
        <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
      <label className="text-sm">Priority<select name="priority" defaultValue={vendor?.priority ?? "must_have"} className={field}><option value="must_have">Must have</option><option value="nice_to_have">Nice to have</option><option value="optional">Optional</option></select></label>
      <label className="text-sm">Budget category<select name="categoryId" defaultValue={vendor?.category_id ?? ""} className={field}><option value="">Not assigned</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="text-sm">Responsible person<input name="assignedTo" defaultValue={vendor?.assigned_to ?? ""} className={field} /></label>
      <label className="text-sm">Website<input name="website" type="url" placeholder="https://" defaultValue={vendor?.website ?? ""} className={field} /></label>
      <label className="text-sm">Address<input name="address" defaultValue={vendor?.address ?? ""} className={field} /></label>
      <label className="text-sm">Currency<select name="currency" defaultValue={vendor?.currency ?? currency} className={field}>{[...new Set([vendor?.currency ?? currency, "USD", "MXN", "CAD", "EUR", "GBP", "VND"])].map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="text-sm">Estimate<input name="estimate" inputMode="decimal" defaultValue={centsToInputValue(vendor?.estimated_cents ?? null)} className={field} /></label>
      <label className="text-sm">Quote<input name="quote" inputMode="decimal" defaultValue={centsToInputValue(vendor?.quoted_cents ?? null)} className={field} /></label>
      <label className="text-sm">Contract amount<input name="contract" inputMode="decimal" defaultValue={centsToInputValue(vendor?.contracted_cents ?? null)} className={field} /></label>
      <label className="text-sm">Booked date<input name="booked" type="date" defaultValue={vendor?.booked_at ?? ""} className={field} /></label>
      <label className="text-sm">Contract signed date<input name="signed" type="date" defaultValue={vendor?.contract_signed_at ?? ""} className={field} /></label>
      <label className="text-sm md:col-span-2">Contract link<input name="contractUrl" type="url" placeholder="https://" defaultValue={vendor?.contract_url ?? ""} className={field} /></label>
      <label className="text-sm md:col-span-2">Notes<textarea name="notes" rows={4} defaultValue={vendor?.notes ?? ""} className={field} /></label>
      {vendor && <label className="flex items-start gap-2 text-sm md:col-span-2"><input name="syncBudget" type="checkbox" className="mt-1" />Apply this contract price to the linked budget line if it has no manually entered price. Multiple linked lines and manual prices are preserved.</label>}
        </div>
      </details>
      {canEdit && <button disabled={pending} className="rounded-lg bg-olive-deep px-4 py-2.5 font-medium text-cream md:col-span-2">{pending ? "Saving…" : vendor ? "Save vendor" : "Add vendor"}</button>}
    </fieldset>
  </form>;
}
